import type { ProviderId } from '../llm/types.js'
import { findPrice } from './prices.js'
import type {
  CostEstimate,
  ModelPrice,
  PriceRates,
  PriceTable,
  PriceTier,
  TokenUsage,
  UnpricedModel,
  UsageLedger,
} from './types.js'

export const tokenUsage = (usage: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedInputTokens?: number
}): TokenUsage => ({
  inputTokens: usage.inputTokens,
  cachedInputTokens: usage.cachedInputTokens ?? 0,
  outputTokens: usage.outputTokens,
})

export const promptTokens = (usage: TokenUsage): number =>
  usage.inputTokens + usage.cachedInputTokens

export const tierFor = (price: ModelPrice, usage: TokenUsage): PriceTier =>
  price.longContext !== null && promptTokens(usage) >= price.longContext.fromPromptTokens
    ? 'long_context'
    : 'standard'

const ratesFor = (price: ModelPrice, tier: PriceTier): PriceRates =>
  tier === 'long_context' && price.longContext !== null ? price.longContext.rates : price.rates

export const costWithRates = (usage: TokenUsage, rates: PriceRates): number =>
  (usage.inputTokens * rates.inputUsdPerMillion +
    usage.cachedInputTokens * rates.cachedInputUsdPerMillion +
    usage.outputTokens * rates.outputUsdPerMillion) /
  1_000_000

export const estimateCost = (
  table: PriceTable,
  provider: ProviderId,
  model: string,
  usage: TokenUsage,
): CostEstimate => {
  const price = findPrice(table, provider, model)
  if (price === undefined) return { kind: 'unknown_model', provider, model }
  const tier = tierFor(price, usage)
  return { kind: 'priced', usd: costWithRates(usage, ratesFor(price, tier)), tier, price }
}

export const emptyLedger: UsageLedger = {
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  pricedUsd: 0,
  unpricedCalls: 0,
  unpricedModels: [],
}

const withUnpricedModel = (
  models: readonly UnpricedModel[],
  model: UnpricedModel,
): readonly UnpricedModel[] =>
  models.some((entry) => entry.provider === model.provider && entry.model === model.model)
    ? models
    : [...models, model]

export const recordCall = (
  ledger: UsageLedger,
  usage: TokenUsage,
  estimate: CostEstimate,
): UsageLedger => ({
  calls: ledger.calls + 1,
  inputTokens: ledger.inputTokens + usage.inputTokens,
  cachedInputTokens: ledger.cachedInputTokens + usage.cachedInputTokens,
  outputTokens: ledger.outputTokens + usage.outputTokens,
  pricedUsd: estimate.kind === 'priced' ? ledger.pricedUsd + estimate.usd : ledger.pricedUsd,
  unpricedCalls: estimate.kind === 'priced' ? ledger.unpricedCalls : ledger.unpricedCalls + 1,
  unpricedModels:
    estimate.kind === 'priced'
      ? ledger.unpricedModels
      : withUnpricedModel(ledger.unpricedModels, {
          provider: estimate.provider,
          model: estimate.model,
        }),
})

export const mergeLedgers = (a: UsageLedger, b: UsageLedger): UsageLedger => ({
  calls: a.calls + b.calls,
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  pricedUsd: a.pricedUsd + b.pricedUsd,
  unpricedCalls: a.unpricedCalls + b.unpricedCalls,
  unpricedModels: b.unpricedModels.reduce(withUnpricedModel, a.unpricedModels),
})
