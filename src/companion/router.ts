import { initialState, step } from '../agent/step.js'
import type { AgentConfig, AgentEvent, Step } from '../agent/types.js'
import { providerNames } from '../llm/errors.js'
import { err, ok } from '../llm/result.js'
import type { ProviderId } from '../llm/types.js'
import { rpcError, rpcErrorCodes, type RpcErrorObject } from '../rpc/jsonrpc.js'
import type { CompanionNotification, SessionHelloParams } from '../rpc/messages.js'
import { mapNotification } from './notifications.js'
import {
  companionErrorCodes,
  type CompanionEffect,
  type CompanionSettings,
  type CompanionState,
  type Conversation,
  type ReplyFor,
  type RequestFor,
  type RouterMethod,
  type Routed,
  type Turn,
} from './types.js'

const modelFor = (settings: CompanionSettings, provider: ProviderId | null): string =>
  provider === null ? '' : settings.models[provider]

const systemFor = (settings: CompanionSettings, provider: ProviderId | null): string =>
  provider === null ? '' : settings.system(provider)

const providerConfig = (settings: CompanionSettings, provider: ProviderId | null) => ({
  model: modelFor(settings, provider),
  system: systemFor(settings, provider),
})

const agentConfig = (settings: CompanionSettings, provider: ProviderId | null): AgentConfig => ({
  ...providerConfig(settings, provider),
  maxOutputTokens: settings.maxOutputTokens,
  maxIterations: settings.maxIterations,
  proposalTtlMs: settings.proposalTtlMs,
  tools: settings.tools,
  pricing: null,
})

export const initialCompanionState = (
  settings: CompanionSettings,
  activeProvider: ProviderId | null = null,
): CompanionState => ({ settings, activeProvider, conversations: {} })

const newConversation = (state: CompanionState, instanceId: string): Conversation => ({
  instanceId,
  agent: initialState(agentConfig(state.settings, state.activeProvider)),
  turn: null,
  turns: 0,
})

const conversationOf = (state: CompanionState, instanceId: string): Conversation =>
  state.conversations[instanceId] ?? newConversation(state, instanceId)

const withConversation = (state: CompanionState, conversation: Conversation): CompanionState => ({
  ...state,
  conversations: { ...state.conversations, [conversation.instanceId]: conversation },
})

const withProvider = (state: CompanionState, provider: ProviderId): CompanionState => ({
  ...state,
  activeProvider: provider,
  conversations: Object.fromEntries(
    Object.entries(state.conversations).map(([id, conversation]) => [
      id,
      {
        ...conversation,
        agent: {
          ...conversation.agent,
          config: { ...conversation.agent.config, ...providerConfig(state.settings, provider) },
        },
      },
    ]),
  ),
})

const notifyEffect = (notification: CompanionNotification): CompanionEffect => ({
  type: 'notify',
  notification,
})

const advance = (
  state: CompanionState,
  conversation: Conversation,
  next: Step,
  prior: readonly CompanionEffect[] = [],
): Routed => {
  const initial = { turn: conversation.turn, effects: prior }
  const mapped = next.effects.reduce<{
    readonly turn: Turn | null
    readonly effects: readonly CompanionEffect[]
  }>((acc, effect) => {
    const instanceId = conversation.instanceId
    switch (effect.type) {
      case 'notify': {
        const result = mapNotification(instanceId, next.state, acc.turn, effect.notification)
        return {
          turn: result.turn,
          effects: [...acc.effects, ...result.notifications.map(notifyEffect)],
        }
      }
      case 'call_llm':
        return state.activeProvider === null
          ? acc
          : {
              turn: acc.turn,
              effects: [
                ...acc.effects,
                {
                  type: 'call_llm',
                  instanceId,
                  provider: state.activeProvider,
                  requestId: effect.requestId,
                  request: effect.request,
                },
              ],
            }
      case 'run_tool':
      case 'plan_change':
        return {
          turn: acc.turn,
          effects: [...acc.effects, { type: effect.type, instanceId, call: effect.call }],
        }
      case 'apply_change':
        return {
          turn: acc.turn,
          effects: [
            ...acc.effects,
            {
              type: 'apply_change',
              instanceId,
              proposalId: effect.proposalId,
              toolName: effect.toolName,
              rows: effect.rows,
            },
          ],
        }
    }
  }, initial)
  const missingProvider =
    state.activeProvider === null
      ? next.effects.find((effect) => effect.type === 'call_llm')
      : undefined
  const updated: Conversation = { ...conversation, agent: next.state, turn: mapped.turn }
  if (missingProvider?.type === 'call_llm')
    return advance(
      withConversation(state, updated),
      updated,
      step(next.state, {
        type: 'llm_response',
        requestId: missingProvider.requestId,
        result: err({ kind: 'exception', message: 'No LLM provider is selected' }),
      }),
      mapped.effects,
    )
  return { state: withConversation(state, updated), effects: mapped.effects }
}

const failure = (code: number, message: string): RpcErrorObject => rpcError(code, message)

const rejected = (state: CompanionState, error: RpcErrorObject) => ({
  state,
  effects: [],
  reply: err(error),
})

const refreshConfig = (state: CompanionState, conversation: Conversation): Conversation => ({
  ...conversation,
  agent: {
    ...conversation.agent,
    config: {
      ...conversation.agent.config,
      ...providerConfig(state.settings, state.activeProvider),
    },
  },
})

const onChatSend = (
  state: CompanionState,
  request: RequestFor<'chat.send'>,
): ReplyFor<'chat.send'> => {
  const conversation = refreshConfig(state, conversationOf(state, request.params.instanceId))
  if (state.activeProvider === null)
    return rejected(
      state,
      failure(companionErrorCodes.noProvider, 'Select a provider and save its API key first'),
    )
  const phase = conversation.agent.phase.kind
  if (phase !== 'idle' && phase !== 'awaiting_decision')
    return rejected(
      state,
      failure(companionErrorCodes.busy, `The assistant is busy (${phase}); cancel the turn first`),
    )
  const superseded: readonly CompanionEffect[] =
    conversation.turn === null
      ? []
      : [
          notifyEffect({
            kind: 'notification',
            method: 'chat.done',
            params: {
              instanceId: conversation.instanceId,
              turnId: conversation.turn.id,
              reason: 'cancelled',
            },
          }),
        ]
  const turn: Turn = { id: `turn-${conversation.turns + 1}`, messages: 0 }
  const started: Conversation = { ...conversation, turn, turns: conversation.turns + 1 }
  const routed = advance(
    state,
    started,
    step(conversation.agent, { type: 'user_message', text: request.params.text }),
    superseded,
  )
  return { ...routed, reply: ok({ turnId: turn.id }) }
}

const onChatCancel = (
  state: CompanionState,
  request: RequestFor<'chat.cancel'>,
): ReplyFor<'chat.cancel'> => {
  const conversation = state.conversations[request.params.instanceId]
  const turnId = request.params.turnId
  if (
    conversation === undefined ||
    conversation.turn === null ||
    (turnId !== null && turnId !== conversation.turn.id)
  )
    return { state, effects: [], reply: ok({ cancelled: false }) }
  const routed = advance(state, conversation, step(conversation.agent, { type: 'cancel' }))
  const after = routed.state.conversations[conversation.instanceId]
  return { ...routed, reply: ok({ cancelled: after?.agent.phase.kind === 'idle' }) }
}

const onChangeDecide = (
  state: CompanionState,
  request: RequestFor<'change.decide'>,
): ReplyFor<'change.decide'> => {
  const { instanceId, proposalId, acceptedRowIds } = request.params
  const conversation = state.conversations[instanceId]
  const unknown = failure(companionErrorCodes.unknownProposal, `No pending proposal ${proposalId}`)
  if (conversation === undefined) return rejected(state, unknown)
  const next = step(conversation.agent, {
    type: 'change_decision',
    proposalId,
    acceptedRowIds,
    at: request.at,
  })
  if (next.state === conversation.agent) return rejected(state, unknown)
  const routed = advance(state, conversation, next)
  const applying = next.effects.some((effect) => effect.type === 'apply_change')
  return { ...routed, reply: ok({ proposalId, outcome: applying ? 'applying' : 'declined' }) }
}

const onKeysSet = (
  state: CompanionState,
  request: RequestFor<'keys.set'>,
): ReplyFor<'keys.set'> => {
  if (!request.stored.ok)
    return rejected(
      state,
      failure(
        request.stored.error.kind === 'invalid_key'
          ? rpcErrorCodes.invalidParams
          : companionErrorCodes.keyStore,
        request.stored.error.message,
      ),
    )
  const next = state.activeProvider === null ? withProvider(state, request.provider) : state
  return { state: next, effects: [], reply: ok({ provider: request.provider, configured: true }) }
}

const onKeysStatus = (
  state: CompanionState,
  request: RequestFor<'keys.status'>,
): ReplyFor<'keys.status'> => ({
  state,
  effects: [],
  reply: ok({ providers: request.providers, activeProvider: state.activeProvider }),
})

const onProviderSelect = (
  state: CompanionState,
  request: RequestFor<'provider.select'>,
): ReplyFor<'provider.select'> =>
  request.configured
    ? {
        state: withProvider(state, request.provider),
        effects: [],
        reply: ok({ activeProvider: request.provider }),
      }
    : rejected(
        state,
        failure(
          companionErrorCodes.missingKey,
          `No ${providerNames[request.provider]} API key is saved`,
        ),
      )

const routes: {
  readonly [M in RouterMethod]: (state: CompanionState, request: RequestFor<M>) => ReplyFor<M>
} = {
  'chat.send': onChatSend,
  'chat.cancel': onChatCancel,
  'change.decide': onChangeDecide,
  'keys.set': onKeysSet,
  'keys.status': onKeysStatus,
  'provider.select': onProviderSelect,
}

export const handleRpc = <M extends RouterMethod>(
  state: CompanionState,
  method: M,
  request: RequestFor<M>,
): ReplyFor<M> => routes[method](state, request)

export const handleHello = (state: CompanionState, hello: SessionHelloParams): Routed => ({
  state: withConversation(state, conversationOf(state, hello.instanceId)),
  effects: [],
})

export const handleAgentEvent = (
  state: CompanionState,
  instanceId: string,
  event: AgentEvent,
): Routed => {
  const conversation = state.conversations[instanceId]
  if (conversation === undefined) return { state, effects: [] }
  return advance(state, conversation, step(conversation.agent, event))
}
