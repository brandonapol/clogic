import type { JsonObject } from '../llm/types.js'

export const logLevels = ['debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof logLevels)[number]

export type LogFields = Readonly<Record<string, unknown>>

export type LogRecord = {
  readonly time: number
  readonly level: LogLevel
  readonly event: string
  readonly context: JsonObject
  readonly fields: JsonObject
}

export type Sink = (record: LogRecord) => void
