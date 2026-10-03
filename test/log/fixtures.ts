import type { LogRecord } from '../../src/log/types.js'

const fakeKey = (prefix: string): string => [prefix, 'q'.repeat(20)].join('')

export const anthropicLike = (): string => fakeKey(['sk', 'ant', ''].join('-'))
export const openAiLike = (): string => fakeKey(['sk', 'proj', ''].join('-'))
export const xaiLike = (): string => fakeKey(['xai', ''].join('-'))
export const bearer = (): string => ['Bearer', 'w'.repeat(24)].join(' ')

export const record = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  time: Date.UTC(2026, 9, 3, 12, 0, 0),
  level: 'info',
  event: 'test.event',
  context: {},
  fields: {},
  ...overrides,
})
