import { describe, expect, it } from 'vitest'
import {
  emptyLedger,
  estimateCost,
  mergeLedgers,
  recordCall,
  tokenUsage,
} from '../../src/usage/estimate.js'
import { defaultPriceTable } from '../../src/usage/prices.js'
import type { PriceTable, UsageLedger } from '../../src/usage/types.js'

const usage = (inputTokens: number, outputTokens: number, cachedInputTokens = 0) =>
  tokenUsage({ inputTokens, outputTokens, cachedInputTokens })

const usd = (estimate: ReturnType<typeof estimateCost>): number =>
  estimate.kind === 'priced' ? estimate.usd : Number.NaN

describe('estimateCost', () => {
  it('prices input and output per million tokens', () => {
    const estimate = estimateCost(
      defaultPriceTable,
      'anthropic',
      'claude-sonnet-5-5',
      usage(1_000_000, 100_000),
    )
    expect(estimate.kind).toBe('priced')
    expect(usd(estimate)).toBeCloseTo(3, 10)
  })

  it('prices cached input at the cached rate', () => {
    const estimate = estimateCost(defaultPriceTable, 'openai', 'gpt-6.1-sol', usage(0, 0, 100_000))
    expect(usd(estimate)).toBeCloseTo(0.01, 10)
  })

  it('treats a missing cached count as zero', () => {
    expect(tokenUsage({ inputTokens: 5, outputTokens: 7 })).toEqual({
      inputTokens: 5,
      cachedInputTokens: 0,
      outputTokens: 7,
    })
  })

  it('switches xAI to long-context rates when the prompt reaches 200k tokens', () => {
    const below = estimateCost(defaultPriceTable, 'xai', 'grok-4.7', usage(199_999, 0))
    const at = estimateCost(defaultPriceTable, 'xai', 'grok-4.7', usage(150_000, 1_000_000, 50_000))
    expect(below.kind === 'priced' && below.tier).toBe('standard')
    expect(at.kind === 'priced' && at.tier).toBe('long_context')
    expect(usd(at)).toBeCloseTo((150_000 * 4 + 50_000 * 1 + 1_000_000 * 12) / 1_000_000, 10)
  })

  it('switches OpenAI to long-context rates only above 272k prompt tokens', () => {
    const at = estimateCost(defaultPriceTable, 'openai', 'gpt-6.1-sol', usage(272_000, 0))
    const above = estimateCost(defaultPriceTable, 'openai', 'gpt-6.1-sol', usage(272_001, 1_000))
    expect(at.kind === 'priced' && at.tier).toBe('standard')
    expect(above.kind === 'priced' && above.tier).toBe('long_context')
    expect(usd(above)).toBeCloseTo((272_001 * 4 + 1_000 * 15) / 1_000_000, 10)
  })

  it('returns unknown_model instead of guessing a price', () => {
    expect(estimateCost(defaultPriceTable, 'openai', 'gpt-6.1-sol-mini', usage(10, 10))).toEqual({
      kind: 'unknown_model',
      provider: 'openai',
      model: 'gpt-6.1-sol-mini',
    })
  })

  it('returns unknown_model for an empty table', () => {
    const empty: PriceTable = []
    expect(estimateCost(empty, 'xai', 'grok-4.7', usage(1, 1)).kind).toBe('unknown_model')
  })
})

describe('usage ledger', () => {
  it('sums tokens and priced cost across calls', () => {
    const calls = [usage(1_000, 500), usage(2_000, 100, 4_000)]
    const ledger = calls.reduce<UsageLedger>(
      (acc, u) => recordCall(acc, u, estimateCost(defaultPriceTable, 'openai', 'gpt-6.1-sol', u)),
      emptyLedger,
    )
    expect(ledger).toMatchObject({
      calls: 2,
      inputTokens: 3_000,
      cachedInputTokens: 4_000,
      outputTokens: 600,
      unpricedCalls: 0,
      unpricedModels: [],
    })
    expect(ledger.pricedUsd).toBeCloseTo((3_000 * 2 + 4_000 * 0.1 + 600 * 10) / 1_000_000, 12)
  })

  it('counts unpriced calls and lists each unknown model once', () => {
    const u = usage(10, 10)
    const unknown = estimateCost(defaultPriceTable, 'xai', 'grok-9', u)
    const ledger = [unknown, unknown].reduce<UsageLedger>(
      (acc, e) => recordCall(acc, u, e),
      emptyLedger,
    )
    expect(ledger.unpricedCalls).toBe(2)
    expect(ledger.pricedUsd).toBe(0)
    expect(ledger.unpricedModels).toEqual([{ provider: 'xai', model: 'grok-9' }])
  })

  it('does not mutate the ledger it is given', () => {
    const before = structuredClone(emptyLedger)
    recordCall(emptyLedger, usage(1, 1), estimateCost(defaultPriceTable, 'xai', 'x', usage(1, 1)))
    expect(emptyLedger).toEqual(before)
  })

  it('merges ledgers, e.g. sessions into a month', () => {
    const u = usage(100, 100)
    const a = recordCall(emptyLedger, u, estimateCost(defaultPriceTable, 'xai', 'grok-9', u))
    const b = recordCall(
      recordCall(emptyLedger, u, estimateCost(defaultPriceTable, 'xai', 'grok-9', u)),
      u,
      estimateCost(defaultPriceTable, 'xai', 'grok-4.7', u),
    )
    const merged = mergeLedgers(a, b)
    expect(merged.calls).toBe(3)
    expect(merged.inputTokens).toBe(300)
    expect(merged.unpricedCalls).toBe(2)
    expect(merged.unpricedModels).toEqual([{ provider: 'xai', model: 'grok-9' }])
    expect(merged.pricedUsd).toBeCloseTo((100 * 2 + 100 * 6) / 1_000_000, 12)
  })
})
