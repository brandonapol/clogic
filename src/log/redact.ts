import { redactText } from '../history/redact.js'
import { redactedMarker } from '../llm/redact.js'
import type { JsonObject, JsonValue } from '../llm/types.js'

export const circularMarker = '[CIRCULAR]'
export const truncatedMarker = '[TRUNCATED]'
export const contentOmittedMarker = '[CONTENT OMITTED]'

const maxDepth = 8
const maxStringLength = 4000

const sensitiveWords: ReadonlySet<string> = new Set([
  'apikey',
  'authorization',
  'auth',
  'bearer',
  'cookie',
  'credential',
  'credentials',
  'passphrase',
  'passwd',
  'password',
  'secret',
  'token',
])

const sensitivePairs: readonly (readonly [string, string])[] = [
  ['api', 'key'],
  ['private', 'key'],
  ['secret', 'key'],
  ['access', 'key'],
  ['set', 'cookie'],
]

const contentKeys: ReadonlySet<string> = new Set([
  'completion',
  'content',
  'contents',
  'messages',
  'prompt',
  'prompts',
  'reply',
  'system',
  'text',
  'transcript',
])

export const keyWords = (key: string): readonly string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)

export const isSensitiveKey = (key: string): boolean => {
  const words = keyWords(key)
  return (
    words.some((word) => sensitiveWords.has(word)) ||
    sensitivePairs.some(([first, second]) =>
      words.some((word, index) => word === first && words[index + 1] === second),
    )
  )
}

export const isContentKey = (key: string): boolean => contentKeys.has(key.toLowerCase())

const clip = (text: string): string =>
  text.length > maxStringLength ? `${text.slice(0, maxStringLength)}${truncatedMarker}` : text

const errorFields = (error: Error): Readonly<Record<string, unknown>> => {
  const extra = Object.fromEntries(
    Object.entries(error).filter(([key]) => key !== 'message' && key !== 'stack'),
  )
  return {
    ...extra,
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  }
}

const isPlainRecord = (value: object): value is Readonly<Record<string, unknown>> =>
  !Array.isArray(value)

const toJsonAt = (value: unknown, depth: number, ancestors: readonly object[]): JsonValue => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return clip(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return `[function ${value.name}]`
  if (ancestors.includes(value)) return circularMarker
  if (depth >= maxDepth) return truncatedMarker
  const nested = [...ancestors, value]
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof Error) return toJsonAt(errorFields(value), depth, nested)
  if (Array.isArray(value)) return value.map((item) => toJsonAt(item, depth + 1, nested))
  if (value instanceof Map) return toJsonAt(Object.fromEntries(value), depth, nested)
  if (value instanceof Set) return toJsonAt([...value], depth, nested)
  if (!isPlainRecord(value)) return null
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toJsonAt(item, depth + 1, nested)]),
  )
}

export const toJsonSafe = (value: unknown): JsonValue => toJsonAt(value, 0, [])

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value)

const mapJson = (
  value: JsonValue,
  onString: (text: string) => string,
  onEntry: (key: string, item: JsonValue) => JsonValue | undefined,
): JsonValue => {
  if (typeof value === 'string') return onString(value)
  if (isJsonArray(value)) return value.map((item) => mapJson(item, onString, onEntry))
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        onEntry(key, item) ?? mapJson(item, onString, onEntry),
      ]),
    )
  return value
}

const asObject = (value: JsonValue): JsonObject =>
  typeof value === 'object' && value !== null && !isJsonArray(value) ? value : { value }

export const redactValue = (value: JsonValue, secrets: readonly string[] = []): JsonValue =>
  mapJson(
    value,
    (text) => redactText(text, secrets),
    (key, item) => (isSensitiveKey(key) && item !== null ? redactedMarker : undefined),
  )

export const redactFields = (fields: unknown, secrets: readonly string[] = []): JsonObject =>
  asObject(redactValue(toJsonSafe(fields), secrets))

export const omitContent = (value: JsonValue): JsonValue =>
  mapJson(
    value,
    (text) => text,
    (key, item) => (isContentKey(key) && item !== null ? contentOmittedMarker : undefined),
  )

const audioExtensions = 'wav|wave|aif|aiff|aifc|caf|mp3|m4a|aac|flac|alac|ogg|opus|logicx|band'

const spacedAudioPathPattern = new RegExp(
  `(?<![\\w:/.])(?:~|/)(?:[^\\n"'/]*/)+([^\\n"'/]+?\\.(?:${audioExtensions}))(?![\\w])`,
  'gi',
)

const pathPattern = /(?<![\w:/.~])(?:~\/|\/)(?:[^\s"'`/()<>[\]{}]+\/)+([^\s"'`/()<>[\]{},;]+)/g

const fileUrlPattern = /\bfile:\/\/(?:[^\s"'`/]*\/)+([^\s"'`/]+)/gi

export const basenamesOnly = (text: string): string =>
  text
    .replace(fileUrlPattern, '$1')
    .replace(spacedAudioPathPattern, '$1')
    .replace(pathPattern, '$1')

const pathWords: ReadonlySet<string> = new Set([
  'path',
  'paths',
  'file',
  'filename',
  'dir',
  'directory',
  'folder',
  'url',
  'cwd',
  'home',
])

const isPathKey = (key: string): boolean => keyWords(key).some((word) => pathWords.has(word))

const lastSegment = (text: string): string => {
  const segments = text.split('/').filter((segment) => segment.length > 0)
  return text.includes('/') ? (segments[segments.length - 1] ?? '') : text
}

export const scrubPaths = (value: JsonValue): JsonValue =>
  mapJson(value, basenamesOnly, (key, item) =>
    isPathKey(key) && typeof item === 'string' && /^(?:~|\/|file:)/.test(item)
      ? lastSegment(item)
      : undefined,
  )

export const omitContentFields = (fields: JsonObject): JsonObject => asObject(omitContent(fields))

export const scrubPathFields = (fields: JsonObject): JsonObject => asObject(scrubPaths(fields))
