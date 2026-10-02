import { isRecord, parseJson, stringField } from './json.js'
import { redactSecrets } from './redact.js'
import type { LlmError, LlmErrorKind, ProviderId } from './types.js'

export const providerNames: Readonly<Record<ProviderId, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI',
}

export const errorKindForStatus = (status: number): LlmErrorKind => {
  if (status === 401) return 'auth'
  if (status === 402) return 'billing'
  if (status === 403) return 'permission'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limit'
  if (status === 503 || status === 529) return 'overloaded'
  if (status >= 500) return 'server'
  return 'bad_request'
}

const messageFromBody = (bodyText: string): string | undefined => {
  const parsed = parseJson(bodyText)
  if (!parsed.ok) return undefined
  const body = parsed.value
  if (!isRecord(body)) return undefined
  const error = body['error']
  if (isRecord(error)) return stringField(error, 'message')
  if (typeof error === 'string') return error
  return stringField(body, 'message')
}

export const httpError = (
  provider: ProviderId,
  status: number,
  bodyText: string,
  secrets: readonly string[],
): LlmError => ({
  kind: errorKindForStatus(status),
  provider,
  status,
  message: redactSecrets(messageFromBody(bodyText) ?? `HTTP ${status}`, secrets),
})

export const llmError = (
  provider: ProviderId,
  kind: LlmErrorKind,
  message: string,
  secrets: readonly string[],
): LlmError => ({ kind, provider, status: undefined, message: redactSecrets(message, secrets) })

export const describeError = (error: LlmError): string => {
  const name = providerNames[error.provider]
  switch (error.kind) {
    case 'missing_key':
      return `No ${name} API key is saved. Paste one in settings.`
    case 'auth':
      return `${name} rejected the API key. Check that it was copied in full and has not been revoked.`
    case 'permission':
      return `The ${name} API key does not have access to this model or endpoint.`
    case 'billing':
      return `${name} reported a billing problem. Check the account's credits and payment details.`
    case 'rate_limit':
      return `${name} rate limit or spend limit reached. Wait a moment or check the account's limits.`
    case 'overloaded':
      return `${name} is temporarily overloaded. Try again shortly.`
    case 'server':
      return `${name} had an internal error. Try again shortly.`
    case 'network':
      return `Could not reach ${name}. Check the internet connection.`
    case 'not_found':
      return `${name} could not find the requested model or endpoint: ${error.message}`
    case 'bad_request':
      return `${name} rejected the request: ${error.message}`
    case 'invalid_response':
      return `${name} returned a response clogic could not understand: ${error.message}`
  }
}
