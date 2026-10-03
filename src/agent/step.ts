import { toAssistantMessage } from '../llm/client.js'
import type { ChatRequest, JsonValue, Message, ToolCall, ToolResult } from '../llm/types.js'
import type { ChangeRow, ToolError } from '../tools/types.js'
import { emptyLedger } from '../usage/estimate.js'
import type { BudgetState } from '../usage/types.js'
import type {
  AgentConfig,
  AgentEffect,
  AgentEvent,
  AgentNotification,
  AgentState,
  Batch,
  ChangeOutcome,
  Proposal,
  Step,
  TurnEndReason,
} from './types.js'
import { accountUsage, budgetBlock } from './usage.js'

export const initialState = (
  config: AgentConfig,
  messages: readonly Message[] = [],
  budget: BudgetState | null = null,
): AgentState => ({
  config,
  messages,
  phase: { kind: 'idle' },
  iterations: 0,
  nextRequestId: 1,
  usage: emptyLedger,
  budget,
})

const notify = (notification: AgentNotification): AgentEffect => ({ type: 'notify', notification })

const unchanged = (state: AgentState, ...notifications: AgentNotification[]): Step => ({
  state,
  effects: notifications.map(notify),
})

const chatRequest = (state: AgentState): ChatRequest => ({
  model: state.config.model,
  system: state.config.system,
  messages: state.messages,
  tools: state.config.tools.map((tool) => tool.definition),
  toolChoice: 'auto',
  maxOutputTokens: state.config.maxOutputTokens,
})

const endTurn = (
  state: AgentState,
  reason: TurnEndReason,
  effects: readonly AgentEffect[],
): Step => ({
  state: { ...state, phase: { kind: 'idle' } },
  effects: [...effects, notify({ type: 'turn_ended', reason })],
})

const callLlm = (state: AgentState, effects: readonly AgentEffect[]): Step => {
  const blocked = budgetBlock(state)
  if (blocked !== undefined) return endTurn(state, 'budget_exceeded', [...effects, notify(blocked)])
  if (state.iterations >= state.config.maxIterations)
    return endTurn(state, 'iteration_limit', effects)
  const requestId = state.nextRequestId
  const next: AgentState = {
    ...state,
    phase: { kind: 'awaiting_llm', requestId },
    iterations: state.iterations + 1,
    nextRequestId: requestId + 1,
  }
  return {
    state: next,
    effects: [...effects, { type: 'call_llm', requestId, request: chatRequest(next) }],
  }
}

const errorResult = (callId: string, error: ToolError): ToolResult => ({
  callId,
  content: error.message,
  isError: true,
})

const valueResult = (callId: string, value: JsonValue): ToolResult => ({
  callId,
  content: JSON.stringify(value),
  isError: false,
})

const appendResult = (batch: Batch, result: ToolResult): Batch => ({
  ...batch,
  results: [...batch.results, result],
})

const flushBatch = (state: AgentState, batch: Batch): AgentState => ({
  ...state,
  messages: [...state.messages, { role: 'tool', results: batch.results }],
})

const toolKind = (state: AgentState, call: ToolCall) =>
  state.config.tools.find((tool) => tool.definition.name === call.name)?.kind

const processQueue = (state: AgentState, batch: Batch, effects: readonly AgentEffect[]): Step => {
  const [call, ...queue] = batch.queue
  if (call === undefined) return callLlm(flushBatch(state, batch), effects)
  const kind = toolKind(state, call)
  if (kind === undefined) {
    const result = errorResult(call.id, {
      kind: 'unknown_tool',
      message: `No tool named ${call.name} is available`,
    })
    return processQueue(state, appendResult({ ...batch, queue }, result), [
      ...effects,
      notify({ type: 'tool_finished', result }),
    ])
  }
  const started = notify({ type: 'tool_started', call, kind })
  return kind === 'read'
    ? {
        state: { ...state, phase: { kind: 'running_tool', call, batch: { ...batch, queue } } },
        effects: [...effects, started, { type: 'run_tool', call }],
      }
    : {
        state: { ...state, phase: { kind: 'planning_change', call, batch: { ...batch, queue } } },
        effects: [...effects, started, { type: 'plan_change', call }],
      }
}

const finishTool = (
  state: AgentState,
  batch: Batch,
  result: ToolResult,
  extra: readonly AgentEffect[] = [],
) =>
  processQueue(state, appendResult(batch, result), [
    ...extra,
    notify({ type: 'tool_finished', result }),
  ])

const rowIds = (rows: readonly ChangeRow[]) => rows.map((row) => row.id)

const outcomeResult = (proposal: Proposal, outcome: ChangeOutcome): ToolResult => ({
  callId: proposal.call.id,
  content: JSON.stringify(outcome),
  isError: outcome.status === 'applied' && outcome.applied.length === 0,
})

const resolveProposal = (
  state: AgentState,
  proposal: Proposal,
  batch: Batch,
  outcome: ChangeOutcome,
): Step =>
  finishTool(state, batch, outcomeResult(proposal, outcome), [
    notify({ type: 'change_resolved', proposalId: proposal.id, outcome }),
  ])

const refused = (proposal: Proposal, status: 'declined' | 'expired'): ChangeOutcome => ({
  status,
  applied: [],
  declined: rowIds(proposal.rows),
  failed: [],
})

const cancelledResult = (call: ToolCall): ToolResult => ({
  callId: call.id,
  content: 'Cancelled by the user before it ran',
  isError: true,
})

const closeBatch = (batch: Batch, pending: readonly ToolResult[]): Batch => ({
  queue: [],
  results: [...batch.results, ...pending, ...batch.queue.map(cancelledResult)],
})

const onUserMessage = (state: AgentState, text: string): Step => {
  const phase = state.phase
  if (phase.kind === 'idle')
    return callLlm(
      { ...state, iterations: 0, messages: [...state.messages, { role: 'user', text }] },
      [],
    )
  if (phase.kind !== 'awaiting_decision')
    return unchanged(state, { type: 'error', error: { kind: 'busy', phase: phase.kind } })
  const outcome = refused(phase.proposal, 'expired')
  const batch = closeBatch(phase.batch, [outcomeResult(phase.proposal, outcome)])
  const flushed = flushBatch(state, batch)
  return callLlm(
    { ...flushed, iterations: 0, messages: [...flushed.messages, { role: 'user', text }] },
    [notify({ type: 'change_resolved', proposalId: phase.proposal.id, outcome })],
  )
}

const onCancel = (state: AgentState): Step => {
  const phase = state.phase
  switch (phase.kind) {
    case 'idle':
      return unchanged(state)
    case 'applying_change':
      return unchanged(state, { type: 'error', error: { kind: 'busy', phase: phase.kind } })
    case 'awaiting_llm':
      return endTurn(state, 'cancelled', [])
    case 'running_tool':
    case 'planning_change':
      return endTurn(
        flushBatch(state, closeBatch(phase.batch, [cancelledResult(phase.call)])),
        'cancelled',
        [],
      )
    case 'awaiting_decision': {
      const outcome = refused(phase.proposal, 'declined')
      const batch = closeBatch(phase.batch, [outcomeResult(phase.proposal, outcome)])
      return endTurn(flushBatch(state, batch), 'cancelled', [
        notify({ type: 'change_resolved', proposalId: phase.proposal.id, outcome }),
      ])
    }
  }
}

export const step = (state: AgentState, event: AgentEvent): Step => {
  const phase = state.phase
  switch (event.type) {
    case 'user_message':
      return onUserMessage(state, event.text)
    case 'cancel':
      return onCancel(state)
    case 'llm_response': {
      if (phase.kind !== 'awaiting_llm' || phase.requestId !== event.requestId)
        return unchanged(state)
      if (!event.result.ok)
        return endTurn(state, 'llm_error', [
          notify({ type: 'error', error: { kind: 'llm', error: event.result.error } }),
        ])
      const response = event.result.value
      const accounted = accountUsage(state, response, response.toolCalls.length === 0)
      const next: AgentState = {
        ...accounted.state,
        messages: [...state.messages, toAssistantMessage(response)],
      }
      const effects: readonly AgentEffect[] = [
        ...(response.text.length > 0
          ? [notify({ type: 'assistant_message', text: response.text })]
          : []),
        ...accounted.notifications.map(notify),
      ]
      return response.toolCalls.length > 0
        ? processQueue(next, { queue: response.toolCalls, results: [] }, effects)
        : endTurn(next, response.stopReason, effects)
    }
    case 'tool_result': {
      if (phase.kind !== 'running_tool' || phase.call.id !== event.callId) return unchanged(state)
      const result = event.result.ok
        ? valueResult(event.callId, event.result.value)
        : errorResult(event.callId, event.result.error)
      return finishTool(state, phase.batch, result)
    }
    case 'change_planned': {
      if (phase.kind !== 'planning_change' || phase.call.id !== event.callId)
        return unchanged(state)
      if (!event.result.ok)
        return finishTool(state, phase.batch, errorResult(event.callId, event.result.error))
      const proposal: Proposal = {
        id: `proposal-${event.callId}`,
        call: phase.call,
        rows: event.result.value,
        expiresAt: event.at + state.config.proposalTtlMs,
      }
      if (proposal.rows.length === 0)
        return resolveProposal(state, proposal, phase.batch, {
          status: 'no_changes',
          applied: [],
          declined: [],
          failed: [],
        })
      return {
        state: { ...state, phase: { kind: 'awaiting_decision', proposal, batch: phase.batch } },
        effects: [notify({ type: 'change_proposed', proposal })],
      }
    }
    case 'change_decision': {
      if (phase.kind !== 'awaiting_decision' || phase.proposal.id !== event.proposalId)
        return unchanged(state, {
          type: 'error',
          error: { kind: 'unknown_proposal', proposalId: event.proposalId },
        })
      const proposal = phase.proposal
      if (event.at > proposal.expiresAt)
        return resolveProposal(state, proposal, phase.batch, refused(proposal, 'expired'))
      const accepted = proposal.rows.filter((row) => event.acceptedRowIds.includes(row.id))
      if (accepted.length === 0)
        return resolveProposal(state, proposal, phase.batch, refused(proposal, 'declined'))
      return {
        state: {
          ...state,
          phase: { kind: 'applying_change', proposal, accepted, batch: phase.batch },
        },
        effects: [
          {
            type: 'apply_change',
            proposalId: proposal.id,
            toolName: proposal.call.name,
            rows: accepted,
          },
        ],
      }
    }
    case 'change_applied': {
      if (phase.kind !== 'applying_change' || phase.proposal.id !== event.proposalId)
        return unchanged(state)
      const acceptedIds = rowIds(phase.accepted)
      const knownIds = (ids: readonly string[]) => ids.filter((id) => acceptedIds.includes(id))
      const failed = event.report.failed.filter((row) => acceptedIds.includes(row.id))
      const applied = knownIds(event.report.applied)
      const unreported = acceptedIds
        .filter((id) => !applied.includes(id) && !failed.some((row) => row.id === id))
        .map((id) => ({ id, message: 'No result reported for this row' }))
      return resolveProposal(state, phase.proposal, phase.batch, {
        status: 'applied',
        applied,
        declined: rowIds(phase.proposal.rows).filter((id) => !acceptedIds.includes(id)),
        failed: [...failed, ...unreported],
      })
    }
  }
}
