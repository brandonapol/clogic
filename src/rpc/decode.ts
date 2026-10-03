import { err, ok, type Result } from '../llm/result.js'
import type { JsonObject, JsonValue } from '../llm/types.js'

export type Decoder<T> = (value: unknown, path: string) => Result<T, string>

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const describe = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

const expected = (path: string, what: string, value: unknown) =>
  err(`${path}: expected ${what}, got ${describe(value)}`)

export const string: Decoder<string> = (value, path) =>
  typeof value === 'string' ? ok(value) : expected(path, 'string', value)

export const nonEmptyString: Decoder<string> = (value, path) =>
  typeof value === 'string' && value.length > 0
    ? ok(value)
    : expected(path, 'non-empty string', value)

export const finiteNumber: Decoder<number> = (value, path) =>
  typeof value === 'number' && Number.isFinite(value)
    ? ok(value)
    : expected(path, 'finite number', value)

export const integer: Decoder<number> = (value, path) =>
  typeof value === 'number' && Number.isSafeInteger(value)
    ? ok(value)
    : expected(path, 'integer', value)

export const nonNegativeInteger: Decoder<number> = (value, path) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? ok(value)
    : expected(path, 'non-negative integer', value)

export const boolean: Decoder<boolean> = (value, path) =>
  typeof value === 'boolean' ? ok(value) : expected(path, 'boolean', value)

export const literal =
  <const T extends readonly (string | number | boolean)[]>(...values: T): Decoder<T[number]> =>
  (value, path) => {
    const match = values.find((candidate) => candidate === value)
    return match === undefined
      ? err(`${path}: expected one of ${values.map((v) => JSON.stringify(v)).join(', ')}`)
      : ok(match)
  }

export const nullable =
  <T>(decoder: Decoder<T>): Decoder<T | null> =>
  (value, path) =>
    value === null ? ok(null) : decoder(value, path)

export const optional =
  <T>(decoder: Decoder<T>): Decoder<T | undefined> =>
  (value, path) =>
    value === undefined ? ok(undefined) : decoder(value, path)

export const array =
  <T>(decoder: Decoder<T>): Decoder<readonly T[]> =>
  (value, path) => {
    if (!Array.isArray(value)) return expected(path, 'array', value)
    const items: unknown[] = value
    return items.reduce<Result<readonly T[], string>>((acc, item, index) => {
      if (!acc.ok) return acc
      const decoded = decoder(item, `${path}[${index}]`)
      return decoded.ok ? ok([...acc.value, decoded.value]) : decoded
    }, ok([]))
  }

export const object =
  <T extends object>(fields: { readonly [K in keyof T]-?: Decoder<T[K]> }): Decoder<T> =>
  (value, path) => {
    if (!isRecord(value)) return expected(path, 'object', value)
    const entries: readonly (readonly [string, Decoder<unknown>])[] = Object.entries(fields)
    const decoded = entries.reduce<Result<Readonly<Record<string, unknown>>, string>>(
      (acc, [key, decoder]) => {
        if (!acc.ok) return acc
        const field = decoder(value[key], `${path}.${key}`)
        if (!field.ok) return field
        return field.value === undefined ? acc : ok({ ...acc.value, [key]: field.value })
      },
      ok({}),
    )
    return decoded.ok ? ok(decoded.value as T) : decoded
  }

const maxJsonDepth = 64

const jsonValueAt = (value: unknown, path: string, depth: number): Result<JsonValue, string> => {
  if (depth > maxJsonDepth) return err(`${path}: nested deeper than ${maxJsonDepth}`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return ok(value)
  if (typeof value === 'number') return finiteNumber(value, path)
  if (Array.isArray(value)) {
    const items: unknown[] = value
    return items.reduce<Result<readonly JsonValue[], string>>((acc, item, index) => {
      if (!acc.ok) return acc
      const decoded = jsonValueAt(item, `${path}[${index}]`, depth + 1)
      return decoded.ok ? ok([...acc.value, decoded.value]) : decoded
    }, ok([]))
  }
  if (isRecord(value)) return jsonObjectAt(value, path, depth)
  return expected(path, 'JSON value', value)
}

const jsonObjectAt = (value: unknown, path: string, depth: number): Result<JsonObject, string> => {
  if (!isRecord(value)) return expected(path, 'object', value)
  return Object.entries(value).reduce<Result<JsonObject, string>>((acc, [key, item]) => {
    if (!acc.ok) return acc
    const decoded = jsonValueAt(item, `${path}.${key}`, depth + 1)
    return decoded.ok ? ok({ ...acc.value, [key]: decoded.value }) : decoded
  }, ok({}))
}

export const jsonValue: Decoder<JsonValue> = (value, path) => jsonValueAt(value, path, 0)

export const jsonObject: Decoder<JsonObject> = (value, path) => jsonObjectAt(value, path, 0)
