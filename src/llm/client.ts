import { httpError, llmError } from './errors.js'
import type { HttpRequest, HttpResponse } from './http.js'
import { parseJson } from './json.js'
import { parseModelIds } from './models.js'
import { adapters } from './providers.js'
import { err, ok, type Result } from './result.js'
import type { AssistantMessage, ChatRequest, ChatResponse, LlmError, ProviderId } from './types.js'

export type FetchLike = (
  url: string,
  init: {
    readonly method: string
    readonly headers: Readonly<Record<string, string>>
    readonly body?: string
  },
) => Promise<{ readonly status: number; readonly text: () => Promise<string> }>

const send = async (
  fetchFn: FetchLike,
  request: HttpRequest,
): Promise<Result<HttpResponse, string>> => {
  try {
    const init =
      request.body === undefined
        ? { method: request.method, headers: request.headers }
        : { method: request.method, headers: request.headers, body: request.body }
    const response = await fetchFn(request.url, init)
    return ok({ status: response.status, bodyText: await response.text() })
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : String(cause))
  }
}

const sendJson = async (
  fetchFn: FetchLike,
  provider: ProviderId,
  apiKey: string,
  request: HttpRequest,
): Promise<Result<unknown, LlmError>> => {
  const secrets = [apiKey]
  const response = await send(fetchFn, request)
  if (!response.ok) return err(llmError(provider, 'network', response.error, secrets))
  const { status, bodyText } = response.value
  if (status < 200 || status >= 300) return err(httpError(provider, status, bodyText, secrets))
  const body = parseJson(bodyText)
  return body.ok ? body : err(llmError(provider, 'invalid_response', body.error, secrets))
}

const missingKey = (provider: ProviderId): LlmError =>
  llmError(provider, 'missing_key', 'No API key', [])

export const chat = async (
  fetchFn: FetchLike,
  provider: ProviderId,
  apiKey: string,
  request: ChatRequest,
): Promise<Result<ChatResponse, LlmError>> => {
  if (apiKey.length === 0) return err(missingKey(provider))
  const adapter = adapters[provider]
  const body = await sendJson(fetchFn, provider, apiKey, adapter.chatRequest(request, apiKey))
  if (!body.ok) return body
  const parsed = adapter.parseChat(body.value)
  return parsed.ok ? parsed : err(llmError(provider, 'invalid_response', parsed.error, [apiKey]))
}

export const validateKey = async (
  fetchFn: FetchLike,
  provider: ProviderId,
  apiKey: string,
): Promise<Result<readonly string[], LlmError>> => {
  if (apiKey.length === 0) return err(missingKey(provider))
  const body = await sendJson(fetchFn, provider, apiKey, adapters[provider].modelsRequest(apiKey))
  if (!body.ok) return body
  const ids = parseModelIds(body.value)
  return ids.ok ? ids : err(llmError(provider, 'invalid_response', ids.error, [apiKey]))
}

export const toAssistantMessage = (response: ChatResponse): AssistantMessage => ({
  role: 'assistant',
  text: response.text,
  toolCalls: response.toolCalls,
  replay: response.replay,
})
