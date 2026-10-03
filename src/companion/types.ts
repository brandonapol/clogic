import type { AgentState, AgentTool } from '../agent/types.js'
import type { KeyStoreError } from '../llm/keystore.js'
import type { Result } from '../llm/result.js'
import type { ChatRequest, ProviderId, ToolCall } from '../llm/types.js'
import type { RpcErrorObject } from '../rpc/jsonrpc.js'
import type {
  ChangeDecideParams,
  ChatCancelParams,
  ChatSendParams,
  CompanionNotification,
  KeyStatus,
  ResultOf,
} from '../rpc/messages.js'
import type { ChangeRow } from '../tools/types.js'
import type { BudgetLimitsInput } from '../usage/budget.js'
import type { BudgetState, PriceTable } from '../usage/types.js'

export type CompanionSettings = {
  readonly system: (provider: ProviderId) => string
  readonly maxOutputTokens: number
  readonly maxIterations: number
  readonly proposalTtlMs: number
  readonly models: Readonly<Record<ProviderId, string>>
  readonly tools: readonly AgentTool[]
  readonly prices: PriceTable
  readonly budget: BudgetLimitsInput
}

export type Turn = {
  readonly id: string
  readonly messages: number
}

export type Conversation = {
  readonly instanceId: string
  readonly agent: AgentState
  readonly turn: Turn | null
  readonly turns: number
}

export type CompanionState = {
  readonly settings: CompanionSettings
  readonly activeProvider: ProviderId | null
  readonly budget: BudgetState | null
  readonly conversations: Readonly<Record<string, Conversation>>
}

export type CompanionEffect =
  | { readonly type: 'notify'; readonly notification: CompanionNotification }
  | {
      readonly type: 'call_llm'
      readonly instanceId: string
      readonly provider: ProviderId
      readonly requestId: number
      readonly request: ChatRequest
    }
  | { readonly type: 'run_tool'; readonly instanceId: string; readonly call: ToolCall }
  | { readonly type: 'plan_change'; readonly instanceId: string; readonly call: ToolCall }
  | {
      readonly type: 'apply_change'
      readonly instanceId: string
      readonly proposalId: string
      readonly toolName: string
      readonly rows: readonly ChangeRow[]
    }

export type Routed = {
  readonly state: CompanionState
  readonly effects: readonly CompanionEffect[]
}

export type Replied<R> = Routed & {
  readonly reply: Result<R, RpcErrorObject>
}

export type RouterRequest =
  | { readonly method: 'chat.send'; readonly params: ChatSendParams }
  | { readonly method: 'chat.cancel'; readonly params: ChatCancelParams }
  | { readonly method: 'change.decide'; readonly params: ChangeDecideParams; readonly at: number }
  | {
      readonly method: 'keys.set'
      readonly provider: ProviderId
      readonly stored: Result<void, KeyStoreError>
    }
  | { readonly method: 'keys.status'; readonly providers: readonly KeyStatus[] }
  | {
      readonly method: 'provider.select'
      readonly provider: ProviderId
      readonly configured: boolean
    }

export type RouterMethod = RouterRequest['method']

export type RequestFor<M extends RouterMethod> = Extract<RouterRequest, { readonly method: M }>

export type ReplyFor<M extends RouterMethod> = Replied<ResultOf<M>>

export const companionErrorCodes = {
  busy: 1000,
  missingKey: 1001,
  noProvider: 1002,
  unknownProposal: 1003,
  keyStore: 1004,
  instanceMismatch: 1005,
} as const
