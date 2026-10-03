import { isRecord, parseJson } from '../llm/json.js'
import { err, ok, type Result } from '../llm/result.js'
import {
  providerIds,
  type AssistantMessage,
  type JsonObject,
  type JsonValue,
  type Message,
  type ProviderId,
  type ProviderReplay,
  type ToolCall,
  type ToolResult,
} from '../llm/types.js'
import type { ChangeRow } from '../tools/types.js'
import { redactRecord } from './redact.js'
import {
  currentVersion,
  type ConversationRecord,
  type DecodeError,
  type PendingProposal,
} from './types.js'

type Fields = Readonly<Record<string, unknown>>
type Decoded<T> = Result<T, string>

const fail = (path: string, expected: string): Decoded<never> =>
  err(`${path}: expected ${expected}`)

const asString = (value: unknown, path: string): Decoded<string> =>
  typeof value === 'string' ? ok(value) : fail(path, 'string')

const asNumber = (value: unknown, path: string): Decoded<number> =>
  typeof value === 'number' && Number.isFinite(value) ? ok(value) : fail(path, 'finite number')

const asBoolean = (value: unknown, path: string): Decoded<boolean> =>
  typeof value === 'boolean' ? ok(value) : fail(path, 'boolean')

const asNullableString = (value: unknown, path: string): Decoded<string | null> =>
  value === null || value === undefined ? ok(null) : asString(value, path)

const asFields = (value: unknown, path: string): Decoded<Fields> =>
  isRecord(value) ? ok(value) : fail(path, 'object')

const asArray = <T>(
  value: unknown,
  path: string,
  item: (entry: unknown, path: string) => Decoded<T>,
): Decoded<readonly T[]> => {
  if (!Array.isArray(value)) return fail(path, 'array')
  const entries: readonly unknown[] = value
  return entries.reduce<Decoded<readonly T[]>>((acc, entry, index) => {
    if (!acc.ok) return acc
    const decoded = item(entry, `${path}[${index}]`)
    return decoded.ok ? ok([...acc.value, decoded.value]) : decoded
  }, ok([]))
}

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item: unknown) => isJsonValue(item))
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

const asJsonValue = (value: unknown, path: string): Decoded<JsonValue> =>
  isJsonValue(value) ? ok(value) : fail(path, 'JSON value')

const asJsonObject = (value: unknown, path: string): Decoded<JsonObject> =>
  isRecord(value) && isJsonValue(value) ? ok(value) : fail(path, 'JSON object')

const isProviderId = (value: unknown): value is ProviderId => providerIds.some((id) => id === value)

const asToolCall = (value: unknown, path: string): Decoded<ToolCall> => {
  const fields = asFields(value, path)
  if (!fields.ok) return fields
  const id = asString(fields.value['id'], `${path}.id`)
  if (!id.ok) return id
  const name = asString(fields.value['name'], `${path}.name`)
  if (!name.ok) return name
  const input = asJsonObject(fields.value['input'], `${path}.input`)
  if (!input.ok) return input
  return ok({ id: id.value, name: name.value, input: input.value })
}

const asToolResult = (value: unknown, path: string): Decoded<ToolResult> => {
  const fields = asFields(value, path)
  if (!fields.ok) return fields
  const callId = asString(fields.value['callId'], `${path}.callId`)
  if (!callId.ok) return callId
  const content = asString(fields.value['content'], `${path}.content`)
  if (!content.ok) return content
  const isError = asBoolean(fields.value['isError'], `${path}.isError`)
  if (!isError.ok) return isError
  return ok({ callId: callId.value, content: content.value, isError: isError.value })
}

const asReplay = (value: unknown, path: string): Decoded<ProviderReplay> => {
  const fields = asFields(value, path)
  if (!fields.ok) return fields
  const provider = fields.value['provider']
  if (!isProviderId(provider)) return fail(`${path}.provider`, 'provider id')
  const items = asArray(fields.value['items'], `${path}.items`, asJsonValue)
  if (!items.ok) return items
  return ok({ provider, items: items.value })
}

const asMessage = (value: unknown, path: string): Decoded<Message> => {
  const fields = asFields(value, path)
  if (!fields.ok) return fields
  const role = fields.value['role']
  if (role === 'user') {
    const text = asString(fields.value['text'], `${path}.text`)
    return text.ok ? ok({ role, text: text.value }) : text
  }
  if (role === 'tool') {
    const results = asArray(fields.value['results'], `${path}.results`, asToolResult)
    return results.ok ? ok({ role, results: results.value }) : results
  }
  if (role === 'assistant') {
    const text = asString(fields.value['text'], `${path}.text`)
    if (!text.ok) return text
    const toolCalls = asArray(fields.value['toolCalls'], `${path}.toolCalls`, asToolCall)
    if (!toolCalls.ok) return toolCalls
    const base: AssistantMessage = { role, text: text.value, toolCalls: toolCalls.value }
    if (fields.value['replay'] === undefined) return ok(base)
    const replay = asReplay(fields.value['replay'], `${path}.replay`)
    return replay.ok ? ok({ ...base, replay: replay.value }) : replay
  }
  return fail(`${path}.role`, "'user', 'assistant' or 'tool'")
}

const asChangeRow = (value: unknown, path: string): Decoded<ChangeRow> => {
  const fields = asFields(value, path)
  if (!fields.ok) return fields
  const id = asString(fields.value['id'], `${path}.id`)
  if (!id.ok) return id
  const control = asString(fields.value['control'], `${path}.control`)
  if (!control.ok) return control
  const location = asString(fields.value['location'], `${path}.location`)
  if (!location.ok) return location
  const before = asJsonValue(fields.value['before'], `${path}.before`)
  if (!before.ok) return before
  const after = asJsonValue(fields.value['after'], `${path}.after`)
  if (!after.ok) return after
  return ok({
    id: id.value,
    control: control.value,
    location: location.value,
    before: before.value,
    after: after.value,
  })
}

const asProposal = (value: unknown, path: string): Decoded<PendingProposal> => {
  const fields = asFields(value, path)
  if (!fields.ok) return fields
  const id = asString(fields.value['id'], `${path}.id`)
  if (!id.ok) return id
  const callId = asString(fields.value['callId'], `${path}.callId`)
  if (!callId.ok) return callId
  const toolName = asString(fields.value['toolName'], `${path}.toolName`)
  if (!toolName.ok) return toolName
  const rows = asArray(fields.value['rows'], `${path}.rows`, asChangeRow)
  if (!rows.ok) return rows
  const expiresAt = asNumber(fields.value['expiresAt'], `${path}.expiresAt`)
  if (!expiresAt.ok) return expiresAt
  return ok({
    id: id.value,
    callId: callId.value,
    toolName: toolName.value,
    rows: rows.value,
    expiresAt: expiresAt.value,
  })
}

const decodeV1 = (fields: Fields): Decoded<ConversationRecord> => {
  const id = asString(fields['id'], 'id')
  if (!id.ok) return id
  const system = asString(fields['system'], 'system')
  if (!system.ok) return system
  const updatedAt = asNumber(fields['updatedAt'], 'updatedAt')
  if (!updatedAt.ok) return updatedAt
  const messages = asArray(fields['messages'], 'messages', asMessage)
  if (!messages.ok) return messages
  return ok({
    version: currentVersion,
    id: id.value,
    projectName: null,
    contextName: null,
    createdAt: updatedAt.value,
    updatedAt: updatedAt.value,
    system: system.value,
    messages: messages.value,
    pendingProposals: [],
    droppedMessages: 0,
  })
}

const decodeV2 = (fields: Fields): Decoded<ConversationRecord> => {
  const base = decodeV1(fields)
  if (!base.ok) return base
  const projectName = asNullableString(fields['projectName'], 'projectName')
  if (!projectName.ok) return projectName
  const contextName = asNullableString(fields['contextName'], 'contextName')
  if (!contextName.ok) return contextName
  const createdAt = asNumber(fields['createdAt'], 'createdAt')
  if (!createdAt.ok) return createdAt
  const pendingProposals = asArray(fields['pendingProposals'], 'pendingProposals', asProposal)
  if (!pendingProposals.ok) return pendingProposals
  const droppedMessages = asNumber(fields['droppedMessages'], 'droppedMessages')
  if (!droppedMessages.ok) return droppedMessages
  return ok({
    ...base.value,
    projectName: projectName.value,
    contextName: contextName.value,
    createdAt: createdAt.value,
    pendingProposals: pendingProposals.value,
    droppedMessages: droppedMessages.value,
  })
}

const decoders: Readonly<Record<number, (fields: Fields) => Decoded<ConversationRecord>>> = {
  1: decodeV1,
  2: decodeV2,
}

export const decodeConversationValue = (
  value: unknown,
): Result<ConversationRecord, DecodeError> => {
  if (!isRecord(value)) return err({ kind: 'invalid_record', message: 'record: expected object' })
  const version = value['version']
  const decoder = typeof version === 'number' ? decoders[version] : undefined
  if (decoder === undefined) return err({ kind: 'unsupported_version', version })
  const decoded = decoder(value)
  return decoded.ok ? decoded : err({ kind: 'invalid_record', message: decoded.error })
}

export const decodeConversation = (text: string): Result<ConversationRecord, DecodeError> => {
  const parsed = parseJson(text)
  return parsed.ok
    ? decodeConversationValue(parsed.value)
    : err({ kind: 'invalid_json', message: parsed.error })
}

export const encodeConversation = (
  record: ConversationRecord,
  secrets: readonly string[] = [],
): string => `${JSON.stringify(redactRecord(record, secrets), null, 2)}\n`
