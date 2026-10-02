import {
  anthropicChatRequest,
  anthropicModelsRequest,
  parseAnthropicResponse,
} from './anthropic.js'
import type { HttpRequest } from './http.js'
import {
  parseResponsesResponse,
  responsesChatRequest,
  responsesModelsRequest,
  type ResponsesDialect,
} from './openai-responses.js'
import type { Result } from './result.js'
import type { ChatRequest, ChatResponse, ProviderId } from './types.js'

export type ProviderAdapter = {
  readonly id: ProviderId
  readonly defaultModel: string
  readonly chatRequest: (request: ChatRequest, apiKey: string) => HttpRequest
  readonly parseChat: (body: unknown) => Result<ChatResponse, string>
  readonly modelsRequest: (apiKey: string) => HttpRequest
}

const openaiDialect: ResponsesDialect = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  statelessReasoning: true,
}

const xaiDialect: ResponsesDialect = {
  provider: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  statelessReasoning: false,
}

const responsesAdapter = (dialect: ResponsesDialect, defaultModel: string): ProviderAdapter => ({
  id: dialect.provider,
  defaultModel,
  chatRequest: (request, apiKey) => responsesChatRequest(dialect, request, apiKey),
  parseChat: (body) => parseResponsesResponse(dialect.provider, body),
  modelsRequest: (apiKey) => responsesModelsRequest(dialect, apiKey),
})

export const adapters: Readonly<Record<ProviderId, ProviderAdapter>> = {
  anthropic: {
    id: 'anthropic',
    defaultModel: 'claude-sonnet-5-5',
    chatRequest: anthropicChatRequest,
    parseChat: parseAnthropicResponse,
    modelsRequest: anthropicModelsRequest,
  },
  openai: responsesAdapter(openaiDialect, 'gpt-6.1-sol'),
  xai: responsesAdapter(xaiDialect, 'grok-4.7'),
}
