import { redactedMarker, redactSecrets } from '../llm/redact.js'
import type {
  JsonObject,
  JsonValue,
  Message,
  ProviderReplay,
  ToolCall,
  ToolResult,
} from '../llm/types.js'
import type { ChangeRow } from '../tools/types.js'
import type { ConversationRecord, PendingProposal } from './types.js'

const bearerPattern = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi

const assignmentPattern =
  /\b(api[_-]?key|x-api-key|access[_-]?token|auth[_-]?token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',;}]{8,}/gi

const sensitiveKeyPattern =
  /^(?:api[_-]?key|x-api-key|authorization|access[_-]?token|auth[_-]?token|secret|password)$/i

export const redactText = (text: string, secrets: readonly string[] = []): string =>
  redactSecrets(text, secrets)
    .replace(bearerPattern, `$1${redactedMarker}`)
    .replace(assignmentPattern, `$1$2${redactedMarker}`)

const redactOptional = (text: string | null, secrets: readonly string[]) =>
  text === null ? null : redactText(text, secrets)

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value)

export const redactJson = (value: JsonValue, secrets: readonly string[] = []): JsonValue => {
  if (typeof value === 'string') return redactText(value, secrets)
  if (isJsonArray(value)) return value.map((item) => redactJson(item, secrets))
  if (typeof value === 'object' && value !== null) return redactObject(value, secrets)
  return value
}

const redactObject = (value: JsonObject, secrets: readonly string[]): JsonObject =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key) && typeof item === 'string'
        ? redactedMarker
        : redactJson(item, secrets),
    ]),
  )

const redactToolCall = (call: ToolCall, secrets: readonly string[]): ToolCall => ({
  ...call,
  input: redactObject(call.input, secrets),
})

const redactToolResult = (result: ToolResult, secrets: readonly string[]): ToolResult => ({
  ...result,
  content: redactText(result.content, secrets),
})

const redactReplay = (replay: ProviderReplay, secrets: readonly string[]): ProviderReplay => ({
  ...replay,
  items: replay.items.map((item) => redactJson(item, secrets)),
})

export const redactMessage = (message: Message, secrets: readonly string[] = []): Message => {
  switch (message.role) {
    case 'user':
      return { role: 'user', text: redactText(message.text, secrets) }
    case 'tool':
      return { role: 'tool', results: message.results.map((r) => redactToolResult(r, secrets)) }
    case 'assistant': {
      const base = {
        role: 'assistant' as const,
        text: redactText(message.text, secrets),
        toolCalls: message.toolCalls.map((call) => redactToolCall(call, secrets)),
      }
      return message.replay === undefined
        ? base
        : { ...base, replay: redactReplay(message.replay, secrets) }
    }
  }
}

const redactRow = (row: ChangeRow, secrets: readonly string[]): ChangeRow => ({
  ...row,
  control: redactText(row.control, secrets),
  location: redactText(row.location, secrets),
  before: redactJson(row.before, secrets),
  after: redactJson(row.after, secrets),
})

const redactProposal = (
  proposal: PendingProposal,
  secrets: readonly string[],
): PendingProposal => ({
  ...proposal,
  rows: proposal.rows.map((row) => redactRow(row, secrets)),
})

export const redactRecord = (
  record: ConversationRecord,
  secrets: readonly string[] = [],
): ConversationRecord => ({
  ...record,
  projectName: redactOptional(record.projectName, secrets),
  contextName: redactOptional(record.contextName, secrets),
  system: redactText(record.system, secrets),
  messages: record.messages.map((message) => redactMessage(message, secrets)),
  pendingProposals: record.pendingProposals.map((proposal) => redactProposal(proposal, secrets)),
})
