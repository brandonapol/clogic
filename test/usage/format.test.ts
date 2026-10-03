import { describe, expect, it } from 'vitest'
import { emptyLedger } from '../../src/usage/estimate.js'
import {
  formatBudgetDecision,
  formatCost,
  formatTokenCount,
  formatUsage,
  formatUsd,
} from '../../src/usage/format.js'
import type { UsageLedger } from '../../src/usage/types.js'

const ledger = (overrides: Partial<UsageLedger>): UsageLedger => ({ ...emptyLedger, ...overrides })

describe('formatTokenCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1k'],
    [12_345, '12.3k'],
    [999_949, '999.9k'],
    [999_950, '1M'],
    [1_250_000, '1.3M'],
    [-5, '0'],
  ])('%d -> %s', (count, text) => {
    expect(formatTokenCount(count)).toBe(text)
  })
})

describe('formatUsd', () => {
  it.each([
    [0, '$0.00'],
    [0.004, '<$0.01'],
    [0.01, '$0.01'],
    [1.235, '$1.24'],
    [1234.5, '$1,234.50'],
    [Number.NaN, '$0.00'],
  ])('%d -> %s', (usd, text) => {
    expect(formatUsd(usd)).toBe(text)
  })
})

describe('usage strings', () => {
  it('says nothing has been used for an empty ledger', () => {
    expect(formatUsage(emptyLedger)).toBe('No tokens used yet')
  })

  it('shows tokens in and out and the cost', () => {
    expect(
      formatUsage(ledger({ calls: 2, inputTokens: 12_000, outputTokens: 800, pricedUsd: 0.032 })),
    ).toBe('12k in · 800 out · $0.03')
  })

  it('counts cached tokens as input and shows them separately', () => {
    expect(
      formatUsage(
        ledger({
          calls: 1,
          inputTokens: 2_000,
          cachedInputTokens: 8_000,
          outputTokens: 10,
          pricedUsd: 0.5,
        }),
      ),
    ).toBe('10k in (8k cached) · 10 out · $0.50')
  })

  it('marks the cost as a lower bound when some calls are unpriced', () => {
    expect(
      formatCost(
        ledger({
          calls: 3,
          pricedUsd: 0.2,
          unpricedCalls: 1,
          unpricedModels: [{ provider: 'xai', model: 'grok-9' }],
        }),
      ),
    ).toBe('at least $0.20 (1 call unpriced: grok-9)')
  })

  it('says the cost is unknown when no call is priced', () => {
    expect(
      formatCost(
        ledger({
          calls: 2,
          unpricedCalls: 2,
          unpricedModels: [{ provider: 'openai', model: 'gpt-x' }],
        }),
      ),
    ).toBe('cost unknown (no price for gpt-x)')
  })
})

describe('formatBudgetDecision', () => {
  it('has no message when allowed', () => {
    expect(formatBudgetDecision({ kind: 'allow' })).toBeNull()
  })

  it('describes a warning', () => {
    expect(
      formatBudgetDecision({
        kind: 'warn',
        statuses: [{ period: 'session', spentUsd: 4.1, limitUsd: 5, fraction: 0.82 }],
      }),
    ).toBe('Session budget 82% used ($4.10 of $5.00)')
  })

  it('describes a block', () => {
    expect(
      formatBudgetDecision({
        kind: 'block',
        statuses: [{ period: 'month', spentUsd: 20.5, limitUsd: 20, fraction: 1.025 }],
      }),
    ).toBe('Monthly budget reached ($20.50 of $20.00). Raise or remove the limit to keep chatting.')
  })
})
