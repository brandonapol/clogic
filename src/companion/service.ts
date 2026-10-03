import type { AgentEvent, AgentLlmError } from '../agent/types.js'
import { llmError, providerNames } from '../llm/errors.js'
import type { KeyStore, KeyStoreError } from '../llm/keystore.js'
import { redactSecrets } from '../llm/redact.js'
import { err, type Err, type Result } from '../llm/result.js'
import {
  providerIds,
  type ChatRequest,
  type ChatResponse,
  type LlmError,
  type ProviderId,
} from '../llm/types.js'
import { rpcError, type RpcErrorObject } from '../rpc/jsonrpc.js'
import type {
  CompanionNotification,
  CompanionNotificationMethod,
  CompanionNotificationSpec,
  KeyStatus,
} from '../rpc/messages.js'
import { listen, type RequestHandlers, type ServerSession } from '../rpc/socket.js'
import { createRegistry, registryExecutor, type Registry } from '../tools/registry.js'
import type { ToolError, Tool } from '../tools/types.js'
import { createBudget, monthKey } from '../usage/budget.js'
import type { BudgetState } from '../usage/types.js'
import { companionName, companionSettings, type SettingsOverrides } from './config.js'
import {
  handleAgentEvent,
  handleHello,
  handleRpc,
  initialCompanionState,
  rollBudgetMonth,
} from './router.js'
import {
  companionErrorCodes,
  type CompanionEffect,
  type CompanionSettings,
  type CompanionState,
  type ReplyFor,
  type RequestFor,
  type RouterMethod,
  type Routed,
} from './types.js'

export type LlmClient = (request: ChatRequest) => Promise<Result<ChatResponse, LlmError>>

export type LlmClientFactory = (provider: ProviderId, apiKey: string) => LlmClient

export type CompanionOptions = {
  readonly socketPath: string
  readonly keyStore: KeyStore
  readonly llmClient: LlmClientFactory
  readonly tools: readonly Tool[]
  readonly provider?: ProviderId
  readonly settings?: SettingsOverrides
  readonly now?: () => number
  readonly name?: string
}

export type Companion = {
  readonly path: string
  readonly state: () => CompanionState
  readonly close: () => Promise<void>
}

type WorkEffect = Exclude<CompanionEffect, { readonly type: 'notify' }>

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const keyStoreFailure = (cause: unknown): KeyStoreError => ({
  kind: 'unavailable',
  message: messageOf(cause),
})

const attempt = async <T, E>(
  task: () => Promise<Result<T, E>>,
  onThrow: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return await task()
  } catch (cause) {
    return err(onThrow(cause))
  }
}

const send = <M extends CompanionNotificationMethod>(
  session: ServerSession,
  notification: { readonly method: M; readonly params: CompanionNotificationSpec[M] },
) => session.notify(notification.method, notification.params)

const buildBudget = (settings: CompanionSettings, month: string): BudgetState => {
  const budget = createBudget(settings.budget, month)
  if (!budget.ok) throw new Error(`Invalid budget settings: ${budget.error.kind}`)
  return budget.value
}

const buildRegistry = (tools: readonly Tool[]): Registry => {
  const registry = createRegistry(tools)
  if (!registry.ok) throw new Error(registry.error)
  return registry.value
}

export const startCompanion = async (options: CompanionOptions): Promise<Companion> => {
  const registry = buildRegistry(options.tools)
  const now = options.now ?? Date.now
  const sessions = new Map<string, ServerSession>()
  const settings = companionSettings(options.tools, options.settings)
  let state = initialCompanionState(
    settings,
    options.provider ?? null,
    buildBudget(settings, monthKey(now())),
  )
  const current = () => rollBudgetMonth(state, monthKey(now()))

  const deliver = (notification: CompanionNotification) => {
    const instanceId = notification.params.instanceId
    const targets =
      instanceId === null
        ? [...sessions.values()]
        : [sessions.get(instanceId)].flatMap((s) => (s === undefined ? [] : [s]))
    targets.forEach((session) => send(session, notification))
  }

  const commit = (routed: Routed) => {
    state = routed.state
    routed.effects.forEach((effect) => {
      if (effect.type === 'notify') deliver(effect.notification)
      else void perform(effect)
    })
  }

  const route = <M extends RouterMethod>(method: M, request: RequestFor<M>) => {
    const routed: ReplyFor<M> = handleRpc(current(), method, request)
    commit(routed)
    return routed.reply
  }

  const hasKey = async (provider: ProviderId): Promise<boolean> => {
    const key = await attempt(() => options.keyStore.get(provider), keyStoreFailure)
    return key.ok && key.value !== undefined && key.value.length > 0
  }

  const callLlm = async (
    provider: ProviderId,
    request: ChatRequest,
  ): Promise<Result<ChatResponse, AgentLlmError>> => {
    const key = await attempt(() => options.keyStore.get(provider), keyStoreFailure)
    if (!key.ok)
      return err({
        kind: 'exception',
        message: `Could not read the ${providerNames[provider]} API key: ${key.error.message}`,
      })
    const apiKey = key.value
    if (apiKey === undefined || apiKey.length === 0)
      return err(llmError(provider, 'missing_key', 'No API key', []))
    return attempt(
      () => options.llmClient(provider, apiKey)(request),
      (cause): AgentLlmError => ({
        kind: 'exception',
        message: redactSecrets(messageOf(cause), [apiKey]),
      }),
    )
  }

  const eventFor = async (effect: WorkEffect): Promise<AgentEvent> => {
    const tools = registryExecutor(registry, { instanceId: effect.instanceId })
    const toolFailure = (cause: unknown): ToolError => ({
      kind: 'failed',
      message: messageOf(cause),
    })
    switch (effect.type) {
      case 'call_llm':
        return {
          type: 'llm_response',
          requestId: effect.requestId,
          result: await callLlm(effect.provider, effect.request),
        }
      case 'run_tool':
        return {
          type: 'tool_result',
          callId: effect.call.id,
          result: await attempt(() => tools.run(effect.call.name, effect.call.input), toolFailure),
        }
      case 'plan_change': {
        const result = await attempt(
          () => tools.plan(effect.call.name, effect.call.input),
          toolFailure,
        )
        return { type: 'change_planned', callId: effect.call.id, at: now(), result }
      }
      case 'apply_change':
        return {
          type: 'change_applied',
          proposalId: effect.proposalId,
          report: await tools.apply(effect.toolName, effect.rows),
        }
    }
  }

  const perform = async (effect: WorkEffect): Promise<void> => {
    const event = await eventFor(effect)
    commit(handleAgentEvent(current(), effect.instanceId, event))
  }

  const sameInstance = (
    session: ServerSession,
    instanceId: string,
  ): Err<RpcErrorObject> | undefined =>
    session.hello()?.instanceId === instanceId
      ? undefined
      : err(
          rpcError(
            companionErrorCodes.instanceMismatch,
            `instanceId ${instanceId} does not match this connection`,
          ),
        )

  const handlers: RequestHandlers = {
    'chat.send': async (params, session) =>
      sameInstance(session, params.instanceId) ??
      route('chat.send', { method: 'chat.send', params }),
    'chat.cancel': async (params, session) =>
      sameInstance(session, params.instanceId) ??
      route('chat.cancel', { method: 'chat.cancel', params }),
    'change.decide': async (params, session) =>
      sameInstance(session, params.instanceId) ??
      route('change.decide', { method: 'change.decide', params, at: now() }),
    'keys.set': async (params) => {
      const stored = await attempt(
        () => options.keyStore.set(params.provider, params.key),
        keyStoreFailure,
      )
      return route('keys.set', { method: 'keys.set', provider: params.provider, stored })
    },
    'keys.status': async () => {
      const providers: readonly KeyStatus[] = await Promise.all(
        providerIds.map(async (provider) => ({ provider, configured: await hasKey(provider) })),
      )
      return route('keys.status', { method: 'keys.status', providers })
    },
    'provider.select': async (params) =>
      route('provider.select', {
        method: 'provider.select',
        provider: params.provider,
        configured: await hasKey(params.provider),
      }),
  }

  const server = await listen({
    path: options.socketPath,
    companion: options.name ?? companionName,
    handlers,
    onHello: (hello, session) => {
      sessions.set(hello.instanceId, session)
      commit(handleHello(state, hello))
    },
  })

  return {
    path: server.path,
    state: () => state,
    close: () => server.close(),
  }
}
