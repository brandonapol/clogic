export type ProviderId = 'anthropic' | 'openai' | 'xai'

export const providerIds: readonly ProviderId[] = ['anthropic', 'openai', 'xai'] as const

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonObject = { readonly [key: string]: JsonValue }

export type JsonSchemaObject = {
  readonly type: 'object'
  readonly properties: { readonly [key: string]: JsonObject }
  readonly required: readonly string[]
  readonly additionalProperties: false
}

export type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchemaObject
}

export type ToolCall = {
  readonly id: string
  readonly name: string
  readonly input: JsonObject
}

export type ToolResult = {
  readonly callId: string
  readonly content: string
  readonly isError: boolean
}

export type ProviderReplay = {
  readonly provider: ProviderId
  readonly items: readonly JsonValue[]
}

export type AssistantMessage = {
  readonly role: 'assistant'
  readonly text: string
  readonly toolCalls: readonly ToolCall[]
  readonly replay?: ProviderReplay
}

export type Message =
  | { readonly role: 'user'; readonly text: string }
  | AssistantMessage
  | { readonly role: 'tool'; readonly results: readonly ToolResult[] }

export type ToolChoice = 'auto' | 'none'

export type ChatRequest = {
  readonly model: string
  readonly system: string
  readonly messages: readonly Message[]
  readonly tools: readonly ToolDefinition[]
  readonly toolChoice: ToolChoice
  readonly maxOutputTokens: number
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'

export type Usage = {
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
}

export type ChatResponse = {
  readonly text: string
  readonly toolCalls: readonly ToolCall[]
  readonly stopReason: StopReason
  readonly usage: Usage
  readonly replay: ProviderReplay
}

export type LlmErrorKind =
  | 'missing_key'
  | 'auth'
  | 'permission'
  | 'billing'
  | 'rate_limit'
  | 'bad_request'
  | 'not_found'
  | 'overloaded'
  | 'server'
  | 'network'
  | 'invalid_response'

export type LlmError = {
  readonly kind: LlmErrorKind
  readonly provider: ProviderId
  readonly status: number | undefined
  readonly message: string
}
