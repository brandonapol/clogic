import type { ChangeOutcome, TurnEndReason } from '../agent/types.js'
import { providerIds, type JsonObject, type ProviderId } from '../llm/types.js'
import type { ChangeRow, FailedRow, ToolKind } from '../tools/types.js'
import {
  array,
  boolean,
  finiteNumber,
  jsonObject,
  jsonValue,
  literal,
  nonEmptyString,
  nonNegativeInteger,
  nullable,
  object,
  string,
  type Decoder,
} from './decode.js'

export type SessionHelloParams = {
  readonly instanceId: string
  readonly contextName: string | null
  readonly sampleRate: number | null
  readonly protocolVersion: number
  readonly client: string
}

export type SessionHelloResult = {
  readonly protocolVersion: number
  readonly companion: string
}

export type ChatSendParams = {
  readonly instanceId: string
  readonly text: string
}

export type ChatSendResult = {
  readonly turnId: string
}

export type ChatCancelParams = {
  readonly instanceId: string
  readonly turnId: string | null
}

export type ChatCancelResult = {
  readonly cancelled: boolean
}

export type ChangeDecideParams = {
  readonly instanceId: string
  readonly proposalId: string
  readonly acceptedRowIds: readonly string[]
}

export type ChangeDecideResult = {
  readonly proposalId: string
  readonly outcome: 'applying' | 'declined'
}

export type KeysSetParams = {
  readonly provider: ProviderId
  readonly key: string
}

export type KeyStatus = {
  readonly provider: ProviderId
  readonly configured: boolean
}

export type KeysSetResult = KeyStatus

export type KeysStatusParams = Readonly<Record<never, never>>

export type KeysStatusResult = {
  readonly providers: readonly KeyStatus[]
  readonly activeProvider: ProviderId | null
}

export type ProviderSelectParams = {
  readonly provider: ProviderId
}

export type ProviderSelectResult = {
  readonly activeProvider: ProviderId
}

export type MeterParams = {
  readonly instanceId: string
  readonly momentaryLufs: number | null
  readonly bands: readonly number[]
}

export type ContextChangedParams = {
  readonly instanceId: string
  readonly contextName: string | null
}

export type ChatMessageParams = {
  readonly instanceId: string
  readonly turnId: string
  readonly messageId: string
  readonly text: string
}

export type ChatDeltaParams = {
  readonly instanceId: string
  readonly turnId: string
  readonly messageId: string
  readonly index: number
  readonly text: string
}

export type ChatDoneParams = {
  readonly instanceId: string
  readonly turnId: string
  readonly reason: TurnEndReason
}

export type ToolStartedParams = {
  readonly instanceId: string
  readonly turnId: string
  readonly callId: string
  readonly name: string
  readonly kind: ToolKind
  readonly input: JsonObject
}

export type ToolFinishedParams = {
  readonly instanceId: string
  readonly turnId: string
  readonly callId: string
  readonly name: string
  readonly status: 'ok' | 'error' | 'proposed'
  readonly summary: string
}

export type ChangeProposedParams = {
  readonly instanceId: string
  readonly proposalId: string
  readonly reason: string
  readonly rows: readonly ChangeRow[]
  readonly expiresAt: string
}

export type ChangeAppliedParams = {
  readonly instanceId: string
  readonly proposalId: string
  readonly status: ChangeOutcome['status']
  readonly applied: readonly string[]
  readonly declined: readonly string[]
  readonly failed: readonly FailedRow[]
}

export type AnalysisResultParams = {
  readonly instanceId: string
  readonly turnId: string | null
  readonly callId: string | null
  readonly analysis: string
  readonly summary: string
  readonly data: JsonObject
}

export type UsageParams = {
  readonly instanceId: string
  readonly turnId: string
  readonly inputTokens: number
  readonly outputTokens: number
}

export type ErrorParams = {
  readonly instanceId: string | null
  readonly turnId: string | null
  readonly code: string
  readonly message: string
}

export type RequestSpec = {
  readonly 'session.hello': { params: SessionHelloParams; result: SessionHelloResult }
  readonly 'chat.send': { params: ChatSendParams; result: ChatSendResult }
  readonly 'chat.cancel': { params: ChatCancelParams; result: ChatCancelResult }
  readonly 'change.decide': { params: ChangeDecideParams; result: ChangeDecideResult }
  readonly 'keys.set': { params: KeysSetParams; result: KeysSetResult }
  readonly 'keys.status': { params: KeysStatusParams; result: KeysStatusResult }
  readonly 'provider.select': { params: ProviderSelectParams; result: ProviderSelectResult }
}

export type PluginNotificationSpec = {
  readonly meter: MeterParams
  readonly 'context.changed': ContextChangedParams
}

export type CompanionNotificationSpec = {
  readonly 'chat.message': ChatMessageParams
  readonly 'chat.delta': ChatDeltaParams
  readonly 'chat.done': ChatDoneParams
  readonly 'tool.started': ToolStartedParams
  readonly 'tool.finished': ToolFinishedParams
  readonly 'change.proposed': ChangeProposedParams
  readonly 'change.applied': ChangeAppliedParams
  readonly 'analysis.result': AnalysisResultParams
  readonly usage: UsageParams
  readonly error: ErrorParams
}

export type RequestMethod = keyof RequestSpec
export type PluginNotificationMethod = keyof PluginNotificationSpec
export type CompanionNotificationMethod = keyof CompanionNotificationSpec

export type ParamsOf<M extends RequestMethod> = RequestSpec[M]['params']
export type ResultOf<M extends RequestMethod> = RequestSpec[M]['result']

export type RpcId = string | number

export type RequestOf<M extends RequestMethod> = {
  readonly kind: 'request'
  readonly id: RpcId
  readonly method: M
  readonly params: ParamsOf<M>
}

export type PluginRequest = { readonly [M in RequestMethod]: RequestOf<M> }[RequestMethod]

export type PluginNotification = {
  readonly [M in PluginNotificationMethod]: {
    readonly kind: 'notification'
    readonly method: M
    readonly params: PluginNotificationSpec[M]
  }
}[PluginNotificationMethod]

export type CompanionNotification = {
  readonly [M in CompanionNotificationMethod]: {
    readonly kind: 'notification'
    readonly method: M
    readonly params: CompanionNotificationSpec[M]
  }
}[CompanionNotificationMethod]

const exhaustive =
  <T extends string>() =>
  <const A extends readonly T[]>(
    ...values: A & ([Exclude<T, A[number]>] extends [never] ? unknown : never)
  ): A =>
    values

export const turnEndReasons = exhaustive<TurnEndReason>()(
  'end_turn',
  'tool_use',
  'max_tokens',
  'refusal',
  'other',
  'iteration_limit',
  'llm_error',
  'cancelled',
)

export const changeStatuses = exhaustive<ChangeOutcome['status']>()(
  'applied',
  'declined',
  'expired',
  'no_changes',
)

const provider: Decoder<ProviderId> = literal(...providerIds)
const instanceId = nonEmptyString
const id = nonEmptyString

const keyStatus = object<KeyStatus>({ provider, configured: boolean })

const changeRow = object<ChangeRow>({
  id,
  control: string,
  location: string,
  before: jsonValue,
  after: jsonValue,
})

export const requestDecoders: {
  readonly [M in RequestMethod]: {
    readonly params: Decoder<ParamsOf<M>>
    readonly result: Decoder<ResultOf<M>>
  }
} = {
  'session.hello': {
    params: object<SessionHelloParams>({
      instanceId,
      contextName: nullable(string),
      sampleRate: nullable(finiteNumber),
      protocolVersion: nonNegativeInteger,
      client: string,
    }),
    result: object<SessionHelloResult>({ protocolVersion: nonNegativeInteger, companion: string }),
  },
  'chat.send': {
    params: object<ChatSendParams>({ instanceId, text: nonEmptyString }),
    result: object<ChatSendResult>({ turnId: id }),
  },
  'chat.cancel': {
    params: object<ChatCancelParams>({ instanceId, turnId: nullable(id) }),
    result: object<ChatCancelResult>({ cancelled: boolean }),
  },
  'change.decide': {
    params: object<ChangeDecideParams>({ instanceId, proposalId: id, acceptedRowIds: array(id) }),
    result: object<ChangeDecideResult>({
      proposalId: id,
      outcome: literal('applying', 'declined'),
    }),
  },
  'keys.set': {
    params: object<KeysSetParams>({ provider, key: nonEmptyString }),
    result: keyStatus,
  },
  'keys.status': {
    params: object<KeysStatusParams>({}),
    result: object<KeysStatusResult>({
      providers: array(keyStatus),
      activeProvider: nullable(provider),
    }),
  },
  'provider.select': {
    params: object<ProviderSelectParams>({ provider }),
    result: object<ProviderSelectResult>({ activeProvider: provider }),
  },
}

export const pluginNotificationDecoders: {
  readonly [M in PluginNotificationMethod]: Decoder<PluginNotificationSpec[M]>
} = {
  meter: object<MeterParams>({
    instanceId,
    momentaryLufs: nullable(finiteNumber),
    bands: array(finiteNumber),
  }),
  'context.changed': object<ContextChangedParams>({ instanceId, contextName: nullable(string) }),
}

export const companionNotificationDecoders: {
  readonly [M in CompanionNotificationMethod]: Decoder<CompanionNotificationSpec[M]>
} = {
  'chat.message': object<ChatMessageParams>({
    instanceId,
    turnId: id,
    messageId: id,
    text: string,
  }),
  'chat.delta': object<ChatDeltaParams>({
    instanceId,
    turnId: id,
    messageId: id,
    index: nonNegativeInteger,
    text: string,
  }),
  'chat.done': object<ChatDoneParams>({
    instanceId,
    turnId: id,
    reason: literal(...turnEndReasons),
  }),
  'tool.started': object<ToolStartedParams>({
    instanceId,
    turnId: id,
    callId: id,
    name: nonEmptyString,
    kind: literal('read', 'change'),
    input: jsonObject,
  }),
  'tool.finished': object<ToolFinishedParams>({
    instanceId,
    turnId: id,
    callId: id,
    name: nonEmptyString,
    status: literal('ok', 'error', 'proposed'),
    summary: string,
  }),
  'change.proposed': object<ChangeProposedParams>({
    instanceId,
    proposalId: id,
    reason: string,
    rows: array(changeRow),
    expiresAt: nonEmptyString,
  }),
  'change.applied': object<ChangeAppliedParams>({
    instanceId,
    proposalId: id,
    status: literal(...changeStatuses),
    applied: array(id),
    declined: array(id),
    failed: array(object<FailedRow>({ id, message: string })),
  }),
  'analysis.result': object<AnalysisResultParams>({
    instanceId,
    turnId: nullable(id),
    callId: nullable(id),
    analysis: nonEmptyString,
    summary: string,
    data: jsonObject,
  }),
  usage: object<UsageParams>({
    instanceId,
    turnId: id,
    inputTokens: nonNegativeInteger,
    outputTokens: nonNegativeInteger,
  }),
  error: object<ErrorParams>({
    instanceId: nullable(instanceId),
    turnId: nullable(id),
    code: nonEmptyString,
    message: string,
  }),
}

const hasOwn = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.hasOwn(table, key)

export const isRequestMethod = (method: string): method is RequestMethod =>
  hasOwn(requestDecoders, method)

export const isPluginNotificationMethod = (method: string): method is PluginNotificationMethod =>
  hasOwn(pluginNotificationDecoders, method)

export const isCompanionNotificationMethod = (
  method: string,
): method is CompanionNotificationMethod => hasOwn(companionNotificationDecoders, method)
