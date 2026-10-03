import type { JsonObject } from '../llm/types.js'
import { createRecord, isEnabled } from './record.js'
import { redactFields } from './redact.js'
import { createRing, pushRing, type Ring } from './ring.js'
import type { LogFields, LogLevel, LogRecord, Sink } from './types.js'

export type LoggerOptions = {
  readonly now: () => number
  readonly sinks?: readonly Sink[]
  readonly level?: LogLevel
  readonly capacity?: number
  readonly context?: LogFields
  readonly secrets?: () => readonly string[]
}

type LogMethod = (event: string, fields?: LogFields) => void

export type Logger = {
  readonly debug: LogMethod
  readonly info: LogMethod
  readonly warn: LogMethod
  readonly error: LogMethod
  readonly log: (level: LogLevel, event: string, fields?: LogFields) => void
  readonly child: (context: LogFields) => Logger
  readonly recent: () => readonly LogRecord[]
}

export const defaultCapacity = 500

type Shared = {
  readonly now: () => number
  readonly sinks: readonly Sink[]
  readonly level: LogLevel
  readonly secrets: () => readonly string[]
  readonly append: (record: LogRecord) => void
  readonly recent: () => readonly LogRecord[]
}

const deliver = (sinks: readonly Sink[], record: LogRecord): void => {
  sinks.forEach((sink) => {
    try {
      sink(record)
    } catch {
      return
    }
  })
}

const build = (shared: Shared, context: JsonObject): Logger => {
  const log: Logger['log'] = (level, event, fields) => {
    if (!isEnabled(shared.level, level)) return
    const record = createRecord({
      time: shared.now(),
      level,
      event,
      context,
      fields: fields ?? {},
      secrets: shared.secrets(),
    })
    shared.append(record)
    deliver(shared.sinks, record)
  }
  return {
    log,
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
    child: (extra) => build(shared, { ...context, ...redactFields(extra, shared.secrets()) }),
    recent: shared.recent,
  }
}

export const createLogger = (options: LoggerOptions): Logger => {
  let ring: Ring<LogRecord> = createRing(options.capacity ?? defaultCapacity)
  const secrets = options.secrets ?? (() => [])
  const shared: Shared = {
    now: options.now,
    sinks: options.sinks ?? [],
    level: options.level ?? 'info',
    secrets,
    append: (record) => {
      ring = pushRing(ring, record)
    },
    recent: () => ring.items,
  }
  return build(shared, redactFields(options.context ?? {}, secrets()))
}
