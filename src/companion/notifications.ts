import type { AgentError, AgentNotification, AgentState } from '../agent/types.js'
import { describeError } from '../llm/errors.js'
import type { ToolCall } from '../llm/types.js'
import type { CompanionNotification } from '../rpc/messages.js'
import { promptTokens } from '../usage/estimate.js'
import type { Turn } from './types.js'

export type Mapped = {
  readonly turn: Turn | null
  readonly notifications: readonly CompanionNotification[]
}

export const maxSummaryLength = 200

export const budgetErrorCodes = {
  warn: 'budget_warning',
  block: 'budget_exceeded',
} as const

export const summarize = (content: string): string =>
  content.length > maxSummaryLength ? `${content.slice(0, maxSummaryLength - 1)}…` : content

const findCall = (agent: AgentState, callId: string): ToolCall | undefined =>
  agent.messages
    .flatMap((message) => (message.role === 'assistant' ? message.toolCalls : []))
    .find((call) => call.id === callId)

const reasonFor = (agent: AgentState, call: ToolCall): string => {
  const message = agent.messages.find(
    (entry) => entry.role === 'assistant' && entry.toolCalls.some((item) => item.id === call.id),
  )
  const text = message?.role === 'assistant' ? message.text.trim() : ''
  return text.length > 0 ? text : `Proposed by ${call.name}`
}

export const describeAgentError = (
  error: AgentError,
): { readonly code: string; readonly message: string } => {
  switch (error.kind) {
    case 'llm':
      return error.error.kind === 'exception'
        ? { code: 'llm_exception', message: error.error.message }
        : { code: error.error.kind, message: describeError(error.error) }
    case 'busy':
      return { code: 'busy', message: `The assistant is busy (${error.phase})` }
    case 'unknown_proposal':
      return {
        code: 'unknown_proposal',
        message: `No pending change proposal ${error.proposalId}`,
      }
  }
}

export const mapNotification = (
  instanceId: string,
  agent: AgentState,
  turn: Turn | null,
  notification: AgentNotification,
): Mapped => {
  const none: Mapped = { turn, notifications: [] }
  const turnId = turn?.id ?? null
  switch (notification.type) {
    case 'error':
      return {
        turn,
        notifications: [
          {
            kind: 'notification',
            method: 'error',
            params: { instanceId, turnId, ...describeAgentError(notification.error) },
          },
        ],
      }
    case 'budget':
      return {
        turn,
        notifications: [
          {
            kind: 'notification',
            method: 'error',
            params: {
              instanceId,
              turnId,
              code: budgetErrorCodes[notification.level],
              message: notification.message,
            },
          },
        ],
      }
    case 'change_proposed': {
      const proposal = notification.proposal
      return {
        turn,
        notifications: [
          {
            kind: 'notification',
            method: 'change.proposed',
            params: {
              instanceId,
              proposalId: proposal.id,
              reason: reasonFor(agent, proposal.call),
              rows: proposal.rows,
              expiresAt: new Date(proposal.expiresAt).toISOString(),
            },
          },
        ],
      }
    }
    case 'change_resolved':
      return {
        turn,
        notifications: [
          {
            kind: 'notification',
            method: 'change.applied',
            params: {
              instanceId,
              proposalId: notification.proposalId,
              ...notification.outcome,
            },
          },
        ],
      }
  }
  if (turn === null) return none
  switch (notification.type) {
    case 'assistant_message': {
      const messageId = `${turn.id}-m${turn.messages + 1}`
      return {
        turn: { ...turn, messages: turn.messages + 1 },
        notifications: [
          {
            kind: 'notification',
            method: 'chat.delta',
            params: { instanceId, turnId: turn.id, messageId, index: 0, text: notification.text },
          },
          {
            kind: 'notification',
            method: 'chat.message',
            params: { instanceId, turnId: turn.id, messageId, text: notification.text },
          },
        ],
      }
    }
    case 'tool_started':
      return {
        turn,
        notifications: [
          {
            kind: 'notification',
            method: 'tool.started',
            params: {
              instanceId,
              turnId: turn.id,
              callId: notification.call.id,
              name: notification.call.name,
              kind: notification.kind,
              input: notification.call.input,
            },
          },
        ],
      }
    case 'tool_finished': {
      const result = notification.result
      return {
        turn,
        notifications: [
          {
            kind: 'notification',
            method: 'tool.finished',
            params: {
              instanceId,
              turnId: turn.id,
              callId: result.callId,
              name: findCall(agent, result.callId)?.name ?? 'unknown',
              status: result.isError ? 'error' : 'ok',
              summary: summarize(result.content),
            },
          },
        ],
      }
    }
    case 'usage':
      return {
        turn,
        notifications: [
          {
            kind: 'notification',
            method: 'usage',
            params: {
              instanceId,
              turnId: turn.id,
              inputTokens: promptTokens(notification.call),
              outputTokens: notification.call.outputTokens,
            },
          },
        ],
      }
    case 'turn_ended':
      return {
        turn: null,
        notifications: [
          {
            kind: 'notification',
            method: 'chat.done',
            params: { instanceId, turnId: turn.id, reason: notification.reason },
          },
        ],
      }
  }
}
