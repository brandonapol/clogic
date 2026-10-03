import { omitContentFields } from './redact.js'
import type { LogRecord } from './types.js'

export type FormatOptions = {
  readonly includeContent?: boolean
}

export const withoutContent = (record: LogRecord): LogRecord => ({
  ...record,
  context: omitContentFields(record.context),
  fields: omitContentFields(record.fields),
})

export const prepareRecord = (record: LogRecord, options: FormatOptions = {}): LogRecord =>
  options.includeContent === true ? record : withoutContent(record)

const maxDate = 8.64e15

export const isoTime = (time: number): string =>
  Number.isFinite(time) && Math.abs(time) <= maxDate ? new Date(time).toISOString() : String(time)

export const recordJson = (record: LogRecord, options: FormatOptions = {}) => {
  const prepared = prepareRecord(record, options)
  return {
    time: isoTime(prepared.time),
    level: prepared.level,
    event: prepared.event,
    context: prepared.context,
    fields: prepared.fields,
  }
}

export const formatLine = (record: LogRecord, options: FormatOptions = {}): string =>
  `${JSON.stringify(recordJson(record, options))}\n`
