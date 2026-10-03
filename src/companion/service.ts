import type { AgentEvent, AgentLlmError } from '../agent/types.js'
import { llmError, providerNames } from '../llm/errors.js'
import type { KeyStore, KeyStoreError } from '../llm/keystore.js'
import { redactSecrets } from '../llm/redact.js'
import { err, ok, type Err, type Result } from '../llm/result.js'
import { diagnosticsBundle } from '../log/diagnostics.js'
import { createLogger, type Logger } from '../log/logger.js'
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
import { systemEnvironment, type CompanionEnvironment } from './environment.js'
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
  readonly logger?: Logger
  readonly secrets?: () => readonly string[]
  readonly environment?: () => CompanionEnvironment
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
  const secrets = options.secrets ?? (() => [])
  const logger = options.logger ?? createLogger({ now, secrets })
  const rpcLog = logger.child({ component: 'rpc' })
  const llmLog = logger.child({ component: 'llm' })
  const toolLog = logger.child({ component: 'tools' })
  const chatLog = logger.child({ component: 'chat' })
  const sessions = new Map<string, ServerSession>()
  const settings = companionSettings(options.tools, options.settings)
  let state = initialCompanionState(
    settings,
    options.provider ?? null,
    buildBudget(settings, monthKey(now())),
  )
  const current = () => rollBudgetMonth(state, monthKey(now()))

  const deliver = (notification: CompanionNotification) => {
    if (notification.method === 'error')
      chatLog.warn('chat.error', {
        code: notification.params.code,
        detail: notification.params.message,
      })
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

  const loggedLlm = async (
    provider: ProviderId,
    request: ChatRequest,
  ): Promise<Result<ChatResponse, AgentLlmError>> => {
    const result = await callLlm(provider, request)
    if (!result.ok)
      llmLog.warn('llm.error', {
        provider,
        model: request.model,
        kind: result.error.kind,
        status: result.error.kind === 'exception' ? null : (result.error.status ?? null),
        detail: result.error.message,
      })
    return result
  }

  const toolFailed = <T>(
    name: string,
    stage: 'run' | 'plan',
    result: Result<T, ToolError>,
  ): Result<T, ToolError> => {
    if (!result.ok)
      toolLog.warn('tool.failed', {
        tool: name,
        stage,
        kind: result.error.kind,
        detail: result.error.message,
      })
    return result
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
          result: await loggedLlm(effect.provider, effect.request),
        }
      case 'run_tool':
        return {
          type: 'tool_result',
          callId: effect.call.id,
          result: toolFailed(
            effect.call.name,
            'run',
            await attempt(() => tools.run(effect.call.name, effect.call.input), toolFailure),
          ),
        }
      case 'plan_change': {
        const result = toolFailed(
          effect.call.name,
          'plan',
          await attempt(() => tools.plan(effect.call.name, effect.call.input), toolFailure),
        )
        return { type: 'change_planned', callId: effect.call.id, at: now(), result }
      }
      case 'apply_change': {
        const report = await tools.apply(effect.toolName, effect.rows)
        if (report.failed.length > 0)
          toolLog.warn('tool.apply_failed', {
            tool: effect.toolName,
            failed: report.failed.length,
            details: report.failed.map((row) => row.message),
          })
        return { type: 'change_applied', proposalId: effect.proposalId, report }
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
    'diagnostics.export': async (params) => {
      const environment = (options.environment ?? (() => systemEnvironment()))()
      const bundle = diagnosticsBundle({
        generatedAt: now(),
        versions: environment.versions,
        os: environment.os,
        records: logger.recent(),
        includeContent: params.includeContent === true,
        secrets: secrets(),
      })
      return ok({
        includesContent: bundle.report.includesContent,
        json: bundle.json,
        text: bundle.text,
      })
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
    onRequest: (report) => rpcLog.info('rpc.request', report),
    onProblem: (problem) =>
      rpcLog.warn('rpc.problem', {
        kind: problem.kind,
        ...(problem.kind === 'decode'
          ? { code: problem.failure.error.code, detail: problem.failure.error.message }
          : { frame: problem.event.kind }),
      }),
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
