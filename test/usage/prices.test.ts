import { describe, expect, it } from 'vitest'
import type { Pricing } from '../../src/agent/types.js'
import { adapters } from '../../src/llm/providers.js'
import { providerIds } from '../../src/llm/types.js'
import { agentPricing, defaultPriceTable, findPrice } from '../../src/usage/prices.js'

describe('price table', () => {
  it('has a price for every provider default model', () => {
    for (const provider of providerIds) {
      expect(findPrice(defaultPriceTable, provider, adapters[provider].defaultModel)).toBeDefined()
    }
  })

  it('records a retrieval date and an https source for every entry', () => {
    for (const entry of defaultPriceTable) {
      expect(entry.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new URL(entry.sourceUrl).protocol).toBe('https:')
    }
  })

  it('has positive rates and cached input no dearer than input', () => {
    for (const entry of defaultPriceTable) {
      const tiers = [entry.rates, ...(entry.longContext === null ? [] : [entry.longContext.rates])]
      for (const rates of tiers) {
        expect(rates.inputUsdPerMillion).toBeGreaterThan(0)
        expect(rates.outputUsdPerMillion).toBeGreaterThan(0)
        expect(rates.cachedInputUsdPerMillion).toBeGreaterThan(0)
        expect(rates.cachedInputUsdPerMillion).toBeLessThanOrEqual(rates.inputUsdPerMillion)
      }
    }
  })

  it('has one entry per provider and model', () => {
    const keys = defaultPriceTable.map((e) => `${e.provider}/${e.model}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('matches model ids exactly and per provider', () => {
    expect(findPrice(defaultPriceTable, 'anthropic', 'claude-sonnet-5-5')?.rates).toEqual({
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.2,
      outputUsdPerMillion: 10,
    })
    expect(findPrice(defaultPriceTable, 'anthropic', 'claude-sonnet-5-5-20260901')).toBeUndefined()
    expect(findPrice(defaultPriceTable, 'anthropic', 'CLAUDE-SONNET-5-5')).toBeUndefined()
    expect(findPrice(defaultPriceTable, 'openai', 'grok-4.7')).toBeUndefined()
  })

  it('converts to the agent config pricing shape', () => {
    const price = findPrice(defaultPriceTable, 'xai', 'grok-4.7')
    if (price === undefined) throw new Error('missing price')
    const pricing: Pricing = agentPricing(price)
    expect(pricing).toEqual({ inputUsdPerMillion: 2, outputUsdPerMillion: 6 })
  })
})
