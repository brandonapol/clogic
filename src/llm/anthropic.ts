import type { HttpRequest } from './http.js'
import { arrayField, isJsonObject, isRecord, numberField, stringField } from './json.js'
import { err, ok, type Result } from './result.js'
import type {
  ChatRequest,
  ChatResponse,
  JsonValue,
  Message,
  StopReason,
  ToolCall,
  ToolDefinition,
} from './types.js'

export const anthropicBaseUrl = 'https://api.anthropic.com/v1'
export const anthropicVersion = '2023-06-01'

export const anthropicHeaders = (apiKey: string): Readonly<Record<string, string>> => ({
  'x-api-key': apiKey,
  'anthropic-version': anthropicVersion,
  'content-type': 'application/json',
})

const toAnthropicTool = (tool: ToolDefinition): JsonValue => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
})

const toAnthropicMessage = (message: Message): JsonValue => {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.text }
    case 'assistant': {
      if (message.replay?.provider === 'anthropic') {
        return { role: 'assistant', content: message.replay.items }
      }
      const textBlocks: readonly JsonValue[] =
        message.text.length > 0 ? [{ type: 'text', text: message.text }] : []
      const toolBlocks: readonly JsonValue[] = message.toolCalls.map((call) => ({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.input,
      }))
      return { role: 'assistant', content: [...textBlocks, ...toolBlocks] }
    }
    case 'tool':
      return {
        role: 'user',
        content: message.results.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.callId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      }
  }
}

export const toAnthropicBody = (request: ChatRequest): JsonValue => ({
  model: request.model,
  max_tokens: request.maxOutputTokens,
  ...(request.system.length > 0 ? { system: request.system } : {}),
  messages: request.messages.map(toAnthropicMessage),
  ...(request.tools.length > 0
    ? {
        tools: request.tools.map(toAnthropicTool),
        tool_choice: { type: request.toolChoice },
      }
    : {}),
})

export const anthropicChatRequest = (request: ChatRequest, apiKey: string): HttpRequest => ({
  method: 'POST',
  url: `${anthropicBaseUrl}/messages`,
  headers: anthropicHeaders(apiKey),
  body: JSON.stringify(toAnthropicBody(request)),
})

export const anthropicModelsRequest = (apiKey: string): HttpRequest => ({
  method: 'GET',
  url: `${anthropicBaseUrl}/models?limit=1`,
  headers: anthropicHeaders(apiKey),
})

const stopReasons: Readonly<Record<string, StopReason>> = {
  end_turn: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
}

const toToolCall = (block: Readonly<Record<string, unknown>>): Result<ToolCall, string> => {
  const id = stringField(block, 'id')
  const name = stringField(block, 'name')
  const input = block['input']
  if (id === undefined || name === undefined || !isJsonObject(input)) {
    return err('tool_use block is missing id, name or object input')
  }
  return ok({ id, name, input })
}

export const parseAnthropicResponse = (body: unknown): Result<ChatResponse, string> => {
  if (!isRecord(body)) return err('Response is not an object')
  const content = arrayField(body, 'content')
  const blocks = content.filter(isRecord)
  const text = blocks
    .filter((block) => block['type'] === 'text')
    .map((block) => stringField(block, 'text') ?? '')
    .join('')
  const calls = blocks.filter((block) => block['type'] === 'tool_use').map(toToolCall)
  const failed = calls.find((call) => !call.ok)
  if (failed !== undefined && !failed.ok) return err(failed.error)
  const toolCalls = calls.flatMap((call) => (call.ok ? [call.value] : []))
  const usage = isRecord(body['usage']) ? body['usage'] : {}
  return ok({
    text,
    toolCalls,
    stopReason: stopReasons[stringField(body, 'stop_reason') ?? ''] ?? 'other',
    usage: {
      inputTokens: numberField(usage, 'input_tokens'),
      cachedInputTokens: numberField(usage, 'cache_read_input_tokens'),
      outputTokens: numberField(usage, 'output_tokens'),
    },
    replay: { provider: 'anthropic', items: content.filter(isJsonObject) },
  })
}
