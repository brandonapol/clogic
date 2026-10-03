import type { ProviderId } from '../llm/types.js'
import type { ModelPrice, PriceTable } from './types.js'

export const pricesRetrievedOn = '2026-10-03'

export const defaultPriceTable: PriceTable = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    rates: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 10 },
    longContext: null,
    retrievedOn: pricesRetrievedOn,
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    provider: 'openai',
    model: 'gpt-6.1-sol',
    rates: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 10 },
    longContext: {
      fromPromptTokens: 272_001,
      rates: { inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 15 },
    },
    retrievedOn: pricesRetrievedOn,
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    provider: 'xai',
    model: 'grok-4.7',
    rates: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 6 },
    longContext: {
      fromPromptTokens: 200_000,
      rates: { inputUsdPerMillion: 4, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 12 },
    },
    retrievedOn: pricesRetrievedOn,
    sourceUrl: 'https://docs.x.ai/docs/models',
  },
] as const

export const findPrice = (
  table: PriceTable,
  provider: ProviderId,
  model: string,
): ModelPrice | undefined =>
  table.find((entry) => entry.provider === provider && entry.model === model)

export const agentPricing = (
  price: ModelPrice,
): { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number } => ({
  inputUsdPerMillion: price.rates.inputUsdPerMillion,
  outputUsdPerMillion: price.rates.outputUsdPerMillion,
})
