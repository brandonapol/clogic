import { redactText } from '../history/redact.js'
import type { JsonObject } from '../llm/types.js'
import { redactFields } from './redact.js'
import { logLevels, type LogFields, type LogLevel, type LogRecord } from './types.js'

export const levelRank = (level: LogLevel): number => logLevels.indexOf(level)

export const isEnabled = (minimum: LogLevel, level: LogLevel): boolean =>
  levelRank(level) >= levelRank(minimum)

export type RecordInput = {
  readonly time: number
  readonly level: LogLevel
  readonly event: string
  readonly context?: LogFields | JsonObject
  readonly fields?: LogFields
  readonly secrets?: readonly string[]
}

export const createRecord = (input: RecordInput): LogRecord => {
  const secrets = input.secrets ?? []
  return {
    time: input.time,
    level: input.level,
    event: redactText(input.event, secrets),
    context: redactFields(input.context ?? {}, secrets),
    fields: redactFields(input.fields ?? {}, secrets),
  }
}
