import { err, ok, type Result } from './result.js'
import type { JsonObject } from './types.js'

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isJsonObject = (value: unknown): value is JsonObject => isRecord(value)

export const parseJson = (text: string): Result<unknown, string> => {
  try {
    return ok(JSON.parse(text) as unknown)
  } catch {
    return err('Response body is not valid JSON')
  }
}

export const stringField = (record: Readonly<Record<string, unknown>>, key: string) => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export const numberField = (record: Readonly<Record<string, unknown>>, key: string) => {
  const value = record[key]
  return typeof value === 'number' ? value : 0
}

export const arrayField = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly unknown[] => {
  const value = record[key]
  return Array.isArray(value) ? value : []
}
