import type { HttpRequest } from './http.js'
import { arrayField, isJsonObject, isRecord, numberField, parseJson, stringField } from './json.js'
import { err, ok, type Result } from './result.js'
import type {
  ChatRequest,
  ChatResponse,
  JsonSchemaObject,
  JsonValue,
  Message,
  ProviderId,
  StopReason,
  ToolCall,
  ToolDefinition,
} from './types.js'

export type ResponsesDialect = {
  readonly provider: ProviderId
  readonly baseUrl: string
  readonly statelessReasoning: boolean
}

export const bearerHeaders = (apiKey: string): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${apiKey}`,
  'content-type': 'application/json',
})

export const isStrictCompatible = (schema: JsonSchemaObject): boolean =>
  Object.keys(schema.properties).every((key) => schema.required.includes(key))

const toFunctionTool = (tool: ToolDefinition): JsonValue => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
  strict: isStrictCompatible(tool.inputSchema),
})

export const toolErrorPrefix = 'Error: '

const toInputItems = (provider: ProviderId, message: Message): readonly JsonValue[] => {
  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: message.text }]
    case 'assistant': {
      if (message.replay?.provider === provider) return message.replay.items
      const textItems: readonly JsonValue[] =
        message.text.length > 0 ? [{ role: 'assistant', content: message.text }] : []
      const callItems: readonly JsonValue[] = message.toolCalls.map((call) => ({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input),
      }))
      return [...textItems, ...callItems]
    }
    case 'tool':
      return message.results.map((result) => ({
        type: 'function_call_output',
        call_id: result.callId,
        output: result.isError ? `${toolErrorPrefix}${result.content}` : result.content,
      }))
  }
}

export const toResponsesBody = (dialect: ResponsesDialect, request: ChatRequest): JsonValue => ({
  model: request.model,
  ...(request.system.length > 0 ? { instructions: request.system } : {}),
  input: request.messages.flatMap((message) => toInputItems(dialect.provider, message)),
  max_output_tokens: request.maxOutputTokens,
  ...(request.tools.length > 0
    ? { tools: request.tools.map(toFunctionTool), tool_choice: request.toolChoice }
    : {}),
  ...(dialect.statelessReasoning ? { store: false, include: ['reasoning.encrypted_content'] } : {}),
})

export const responsesChatRequest = (
  dialect: ResponsesDialect,
  request: ChatRequest,
  apiKey: string,
): HttpRequest => ({
  method: 'POST',
  url: `${dialect.baseUrl}/responses`,
  headers: bearerHeaders(apiKey),
  body: JSON.stringify(toResponsesBody(dialect, request)),
})

export const responsesModelsRequest = (dialect: ResponsesDialect, apiKey: string): HttpRequest => ({
  method: 'GET',
  url: `${dialect.baseUrl}/models`,
  headers: bearerHeaders(apiKey),
})

const toToolCall = (item: Readonly<Record<string, unknown>>): Result<ToolCall, string> => {
  const id = stringField(item, 'call_id')
  const name = stringField(item, 'name')
  const args = stringField(item, 'arguments')
  if (id === undefined || name === undefined || args === undefined) {
    return err('function_call item is missing call_id, name or arguments')
  }
  const parsed = parseJson(args)
  if (!parsed.ok || !isJsonObject(parsed.value)) {
    return err(`function_call ${name} arguments are not a JSON object`)
  }
  return ok({ id, name, input: parsed.value })
}

const messageParts = (items: readonly Readonly<Record<string, unknown>>[], partType: string) =>
  items
    .filter((item) => item['type'] === 'message')
    .flatMap((item) => arrayField(item, 'content').filter(isRecord))
    .filter((part) => part['type'] === partType)

const stopReasonOf = (
  body: Readonly<Record<string, unknown>>,
  hasToolCalls: boolean,
  hasRefusal: boolean,
): StopReason => {
  const details = body['incomplete_details']
  if (isRecord(details) && stringField(details, 'reason') === 'max_output_tokens') {
    return 'max_tokens'
  }
  if (hasToolCalls) return 'tool_use'
  if (hasRefusal) return 'refusal'
  return stringField(body, 'status') === 'completed' ? 'end_turn' : 'other'
}

export const parseResponsesResponse = (
  provider: ProviderId,
  body: unknown,
): Result<ChatResponse, string> => {
  if (!isRecord(body)) return err('Response is not an object')
  if (stringField(body, 'status') === 'failed') {
    const error = body['error']
    return err(
      isRecord(error) ? (stringField(error, 'message') ?? 'Response failed') : 'Response failed',
    )
  }
  const output = arrayField(body, 'output')
  const items = output.filter(isRecord)
  const text = messageParts(items, 'output_text')
    .map((part) => stringField(part, 'text') ?? '')
    .join('')
  const refusals = messageParts(items, 'refusal')
  const calls = items.filter((item) => item['type'] === 'function_call').map(toToolCall)
  const failed = calls.find((call) => !call.ok)
  if (failed !== undefined && !failed.ok) return err(failed.error)
  const toolCalls = calls.flatMap((call) => (call.ok ? [call.value] : []))
  const usage = isRecord(body['usage']) ? body['usage'] : {}
  return ok({
    text,
    toolCalls,
    stopReason: stopReasonOf(body, toolCalls.length > 0, refusals.length > 0),
    usage: {
      inputTokens: numberField(usage, 'input_tokens'),
      outputTokens: numberField(usage, 'output_tokens'),
    },
    replay: { provider, items: output.filter(isJsonObject) },
  })
}
