import { describe, expect, it } from 'vitest'
import { createLogger } from '../../src/log/logger.js'
import { createRing, pushRing } from '../../src/log/ring.js'
import type { LogRecord } from '../../src/log/types.js'
import { anthropicLike, bearer } from './fixtures.js'

const clock = () => {
  let time = 1000
  return () => {
    time += 1
    return time
  }
}

describe('ring', () => {
  it('keeps only the newest items up to capacity without mutating', () => {
    const empty = createRing<number>(3)
    const full = [1, 2, 3, 4, 5].reduce(pushRing, empty)
    expect(full.items).toEqual([3, 4, 5])
    expect(empty.items).toEqual([])
  })

  it('holds nothing with zero capacity', () => {
    expect(pushRing(createRing<number>(0), 1).items).toEqual([])
  })
})

describe('createLogger', () => {
  it('stamps records with the injected clock and merges context', () => {
    const logger = createLogger({ now: () => 42, context: { component: 'companion' } })
    logger.info('rpc.request', { method: 'chat.send' })
    expect(logger.recent()).toEqual([
      {
        time: 42,
        level: 'info',
        event: 'rpc.request',
        context: { component: 'companion' },
        fields: { method: 'chat.send' },
      },
    ])
  })

  it('redacts every record before it is stored or delivered', () => {
    const delivered: LogRecord[] = []
    const logger = createLogger({
      now: clock(),
      sinks: [(record) => delivered.push(record)],
      context: { apiKey: anthropicLike() },
      secrets: () => ['session-secret-value'],
    })
    logger.child({ header: bearer() }).error(`failed ${anthropicLike()}`, {
      error: new Error(`401 for ${anthropicLike()} session-secret-value`),
    })
    const encoded = JSON.stringify([logger.recent(), delivered])
    expect(encoded).not.toContain(anthropicLike())
    expect(encoded).not.toContain(bearer())
    expect(encoded).not.toContain('session-secret-value')
    expect(delivered).toHaveLength(1)
  })

  it('bounds the ring buffer of recent records', () => {
    const logger = createLogger({ now: clock(), capacity: 3 })
    Array.from({ length: 10 }, (_, index) => logger.info(`event.${index}`))
    expect(logger.recent().map((record) => record.event)).toEqual(['event.7', 'event.8', 'event.9'])
  })

  it('drops records below the minimum level', () => {
    const logger = createLogger({ now: clock(), level: 'warn' })
    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')
    expect(logger.recent().map((record) => record.level)).toEqual(['warn', 'error'])
  })

  it('shares the buffer with child loggers', () => {
    const logger = createLogger({ now: clock(), context: { a: 1 } })
    logger.child({ b: 2 }).child({ c: 3 }).info('nested')
    expect(logger.recent()[0]?.context).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('keeps logging when a sink throws', () => {
    const delivered: string[] = []
    const logger = createLogger({
      now: clock(),
      sinks: [
        () => {
          throw new Error('disk full')
        },
        (record) => delivered.push(record.event),
      ],
    })
    expect(() => logger.info('still.here')).not.toThrow()
    expect(delivered).toEqual(['still.here'])
  })
})
