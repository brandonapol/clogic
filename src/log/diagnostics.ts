import { redactText } from '../history/redact.js'
import type { JsonObject } from '../llm/types.js'
import { isoTime, recordJson } from './format.js'
import { basenamesOnly, redactFields, scrubPathFields } from './redact.js'
import type { LogRecord } from './types.js'

export type DiagnosticsInput = {
  readonly generatedAt: number
  readonly versions: Readonly<Record<string, string>>
  readonly os: Readonly<Record<string, string>>
  readonly records: readonly LogRecord[]
  readonly includeContent?: boolean
  readonly secrets?: readonly string[]
}

export type DiagnosticsRecord = {
  readonly time: string
  readonly level: string
  readonly event: string
  readonly context: JsonObject
  readonly fields: JsonObject
}

export type DiagnosticsReport = {
  readonly format: 'clogic-diagnostics'
  readonly formatVersion: 1
  readonly generatedAt: string
  readonly includesContent: boolean
  readonly versions: JsonObject
  readonly os: JsonObject
  readonly records: readonly DiagnosticsRecord[]
}

export type DiagnosticsBundle = {
  readonly report: DiagnosticsReport
  readonly json: string
  readonly text: string
}

const clean = (fields: unknown, secrets: readonly string[]): JsonObject =>
  scrubPathFields(redactFields(fields, secrets))

const cleanRecord = (
  record: LogRecord,
  includeContent: boolean,
  secrets: readonly string[],
): DiagnosticsRecord => {
  const json = recordJson(record, { includeContent })
  return {
    time: json.time,
    level: json.level,
    event: basenamesOnly(redactText(json.event, secrets)),
    context: clean(json.context, secrets),
    fields: clean(json.fields, secrets),
  }
}

const textLines = (title: string, values: JsonObject): readonly string[] => [
  `${title}:`,
  ...Object.entries(values).map(([key, value]) =>
    typeof value === 'string' ? `  ${key}: ${value}` : `  ${key}: ${JSON.stringify(value)}`,
  ),
]

const recordLine = (record: DiagnosticsRecord): string => {
  const extras = [
    Object.keys(record.context).length > 0 ? JSON.stringify(record.context) : '',
    Object.keys(record.fields).length > 0 ? JSON.stringify(record.fields) : '',
  ].filter((part) => part.length > 0)
  return [record.time, record.level.toUpperCase(), record.event, ...extras].join(' ')
}

export const renderDiagnosticsText = (report: DiagnosticsReport): string =>
  [
    'clogic diagnostics',
    `Generated: ${report.generatedAt}`,
    `Message contents: ${report.includesContent ? 'included' : 'omitted'}`,
    '',
    ...textLines('Versions', report.versions),
    '',
    ...textLines('System', report.os),
    '',
    `Recent log records (${report.records.length}):`,
    ...report.records.map(recordLine),
    '',
  ].join('\n')

export const diagnosticsBundle = (input: DiagnosticsInput): DiagnosticsBundle => {
  const includeContent = input.includeContent === true
  const secrets = input.secrets ?? []
  const report: DiagnosticsReport = {
    format: 'clogic-diagnostics',
    formatVersion: 1,
    generatedAt: isoTime(input.generatedAt),
    includesContent: includeContent,
    versions: clean(input.versions, secrets),
    os: clean(input.os, secrets),
    records: input.records.map((record) => cleanRecord(record, includeContent, secrets)),
  }
  return {
    report,
    json: `${JSON.stringify(report, null, 2)}\n`,
    text: renderDiagnosticsText(report),
  }
}
