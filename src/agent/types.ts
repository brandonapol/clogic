import type { Result } from '../llm/result.js'
import type {
  ChatRequest,
  ChatResponse,
  JsonValue,
  LlmError,
  Message,
  StopReason,
  ToolCall,
  ToolDefinition,
  ToolResult,
  Usage,
} from '../llm/types.js'
import type { ApplyReport, ChangeRow, ToolError, ToolKind } from '../tools/types.js'

export type AgentTool = {
  readonly definition: ToolDefinition
  readonly kind: ToolKind
}

export type Pricing = {
  readonly inputUsdPerMillion: number
  readonly outputUsdPerMillion: number
}

export type AgentConfig = {
  readonly model: string
  readonly system: string
  readonly maxOutputTokens: number
  readonly maxIterations: number
  readonly proposalTtlMs: number
  readonly tools: readonly AgentTool[]
  readonly pricing: Pricing | null
}

export type UsageTotals = {
  readonly llmCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number | null
}

export type Proposal = {
  readonly id: string
  readonly call: ToolCall
  readonly rows: readonly ChangeRow[]
  readonly expiresAt: number
}

export type Batch = {
  readonly queue: readonly ToolCall[]
  readonly results: readonly ToolResult[]
}

export type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'awaiting_llm'; readonly requestId: number }
  | { readonly kind: 'running_tool'; readonly call: ToolCall; readonly batch: Batch }
  | { readonly kind: 'planning_change'; readonly call: ToolCall; readonly batch: Batch }
  | { readonly kind: 'awaiting_decision'; readonly proposal: Proposal; readonly batch: Batch }
  | {
      readonly kind: 'applying_change'
      readonly proposal: Proposal
      readonly accepted: readonly ChangeRow[]
      readonly batch: Batch
    }

export type AgentState = {
  readonly config: AgentConfig
  readonly messages: readonly Message[]
  readonly phase: Phase
  readonly iterations: number
  readonly nextRequestId: number
  readonly usage: UsageTotals
}

export type AgentLlmError = LlmError | { readonly kind: 'exception'; readonly message: string }

export type AgentEvent =
  | { readonly type: 'user_message'; readonly text: string }
  | {
      readonly type: 'llm_response'
      readonly requestId: number
      readonly result: Result<ChatResponse, AgentLlmError>
    }
  | {
      readonly type: 'tool_result'
      readonly callId: string
      readonly result: Result<JsonValue, ToolError>
    }
  | {
      readonly type: 'change_planned'
      readonly callId: string
      readonly at: number
      readonly result: Result<readonly ChangeRow[], ToolError>
    }
  | {
      readonly type: 'change_decision'
      readonly proposalId: string
      readonly acceptedRowIds: readonly string[]
      readonly at: number
    }
  | { readonly type: 'change_applied'; readonly proposalId: string; readonly report: ApplyReport }
  | { readonly type: 'cancel' }

export type TurnEndReason = StopReason | 'iteration_limit' | 'llm_error' | 'cancelled'

export type ChangeOutcome = {
  readonly status: 'applied' | 'declined' | 'expired' | 'no_changes'
  readonly applied: readonly string[]
  readonly declined: readonly string[]
  readonly failed: ApplyReport['failed']
}

export type AgentError =
  | { readonly kind: 'llm'; readonly error: AgentLlmError }
  | { readonly kind: 'busy'; readonly phase: Phase['kind'] }
  | { readonly kind: 'unknown_proposal'; readonly proposalId: string }

export type AgentNotification =
  | { readonly type: 'assistant_message'; readonly text: string }
  | { readonly type: 'tool_started'; readonly call: ToolCall; readonly kind: ToolKind }
  | { readonly type: 'tool_finished'; readonly result: ToolResult }
  | { readonly type: 'change_proposed'; readonly proposal: Proposal }
  | {
      readonly type: 'change_resolved'
      readonly proposalId: string
      readonly outcome: ChangeOutcome
    }
  | { readonly type: 'usage'; readonly call: Usage; readonly total: UsageTotals }
  | { readonly type: 'turn_ended'; readonly reason: TurnEndReason }
  | { readonly type: 'error'; readonly error: AgentError }

export type AgentEffect =
  | { readonly type: 'call_llm'; readonly requestId: number; readonly request: ChatRequest }
  | { readonly type: 'run_tool'; readonly call: ToolCall }
  | { readonly type: 'plan_change'; readonly call: ToolCall }
  | {
      readonly type: 'apply_change'
      readonly proposalId: string
      readonly toolName: string
      readonly rows: readonly ChangeRow[]
    }
  | { readonly type: 'notify'; readonly notification: AgentNotification }

export type Step = {
  readonly state: AgentState
  readonly effects: readonly AgentEffect[]
}
