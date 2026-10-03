import { providerNames } from '../llm/errors.js'
import type { JsonValue } from '../llm/types.js'
import type { RpcErrorObject } from '../rpc/jsonrpc.js'
import type {
  ChangeAppliedParams,
  ChangeProposedParams,
  CompanionNotification,
  KeysStatusResult,
} from '../rpc/messages.js'

export type RenderState = {
  readonly openMessageId: string | null
}

export const initialRenderState: RenderState = { openMessageId: null }

export type Rendered = {
  readonly state: RenderState
  readonly output: string
}

const maxInputLength = 120

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const showValue = (value: JsonValue): string =>
  typeof value === 'string' ? value : JSON.stringify(value)

const lines = (...entries: readonly string[]): string => entries.map((line) => `${line}\n`).join('')

export const renderProposal = (params: ChangeProposedParams): string =>
  lines(
    `Proposed change ${params.proposalId}: ${params.reason}`,
    ...params.rows.map(
      (row, index) =>
        `  ${index + 1}. ${row.location} ${row.control}: ${showValue(row.before)} -> ${showValue(row.after)}`,
    ),
    `  expires ${params.expiresAt}`,
  )

export const renderApplied = (params: ChangeAppliedParams): string =>
  lines(
    `  [change] ${params.proposalId} ${params.status}: ${params.applied.length} applied, ${params.declined.length} declined, ${params.failed.length} failed`,
    ...params.failed.map((row) => `    ${row.id}: ${row.message}`),
  )

const renderLines = (notification: CompanionNotification): string => {
  switch (notification.method) {
    case 'chat.delta':
    case 'chat.message':
      return ''
    case 'chat.done':
      return notification.params.reason === 'end_turn'
        ? ''
        : lines(`  [turn ended: ${notification.params.reason}]`)
    case 'tool.started':
      return lines(
        `  [tool] ${notification.params.name} ${clip(JSON.stringify(notification.params.input), maxInputLength)}`,
      )
    case 'tool.finished':
      return lines(
        `  [tool] ${notification.params.name} ${notification.params.status}: ${notification.params.summary}`,
      )
    case 'change.proposed':
      return renderProposal(notification.params)
    case 'change.applied':
      return renderApplied(notification.params)
    case 'analysis.result':
      return lines(`  [analysis] ${notification.params.analysis}: ${notification.params.summary}`)
    case 'usage':
      return lines(
        `  [usage] ${notification.params.inputTokens} in / ${notification.params.outputTokens} out tokens`,
      )
    case 'error':
      return lines(`  [error] ${notification.params.code}: ${notification.params.message}`)
  }
}

const closeOpen = (state: RenderState): string => (state.openMessageId === null ? '' : '\n')

export const renderNotification = (
  state: RenderState,
  notification: CompanionNotification,
): Rendered => {
  if (notification.method === 'chat.delta') {
    const { messageId, text } = notification.params
    const prefix = state.openMessageId === messageId ? '' : closeOpen(state)
    return { state: { openMessageId: messageId }, output: prefix + text }
  }
  if (notification.method === 'chat.message') {
    const { messageId, text } = notification.params
    return state.openMessageId === messageId
      ? { state: initialRenderState, output: '\n' }
      : { state: initialRenderState, output: `${closeOpen(state)}${text}\n` }
  }
  return { state: initialRenderState, output: closeOpen(state) + renderLines(notification) }
}

export const renderStatus = (status: KeysStatusResult): string =>
  lines(
    `Active provider: ${status.activeProvider === null ? 'none' : providerNames[status.activeProvider]}`,
    ...status.providers.map(
      (entry) =>
        `  ${providerNames[entry.provider].padEnd(10)} ${entry.configured ? 'key saved' : 'no key'}`,
    ),
  )

export const renderRpcError = (action: string, error: RpcErrorObject): string =>
  lines(`  [error] ${action} failed (${error.code}): ${error.message}`)
