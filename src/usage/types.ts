import type { ProviderId } from '../llm/types.js'

export type TokenUsage = {
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
}

export type PriceRates = {
  readonly inputUsdPerMillion: number
  readonly cachedInputUsdPerMillion: number
  readonly outputUsdPerMillion: number
}

export type LongContextPricing = {
  readonly fromPromptTokens: number
  readonly rates: PriceRates
}

export type ModelPrice = {
  readonly provider: ProviderId
  readonly model: string
  readonly rates: PriceRates
  readonly longContext: LongContextPricing | null
  readonly retrievedOn: string
  readonly sourceUrl: string
}

export type PriceTable = readonly ModelPrice[]

export type PriceTier = 'standard' | 'long_context'

export type CostEstimate =
  | {
      readonly kind: 'priced'
      readonly usd: number
      readonly tier: PriceTier
      readonly price: ModelPrice
    }
  | { readonly kind: 'unknown_model'; readonly provider: ProviderId; readonly model: string }

export type UnpricedModel = {
  readonly provider: ProviderId
  readonly model: string
}

export type UsageLedger = {
  readonly calls: number
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  readonly pricedUsd: number
  readonly unpricedCalls: number
  readonly unpricedModels: readonly UnpricedModel[]
}

export type BudgetPeriod = 'session' | 'month'

export type BudgetLimits = {
  readonly sessionUsd: number | null
  readonly monthlyUsd: number | null
  readonly warnFraction: number
}

export type BudgetState = {
  readonly limits: BudgetLimits
  readonly month: string
  readonly sessionSpentUsd: number
  readonly monthSpentUsd: number
  readonly unpricedCalls: number
}

export type BudgetStatus = {
  readonly period: BudgetPeriod
  readonly spentUsd: number
  readonly limitUsd: number
  readonly fraction: number
}

export type BudgetDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'warn'; readonly statuses: readonly BudgetStatus[] }
  | { readonly kind: 'block'; readonly statuses: readonly BudgetStatus[] }

export type BudgetUpdate = {
  readonly state: BudgetState
  readonly decision: BudgetDecision
  readonly newlyWarned: readonly BudgetPeriod[]
  readonly newlyBlocked: readonly BudgetPeriod[]
}

export type BudgetConfigError =
  | { readonly kind: 'invalid_limit'; readonly period: BudgetPeriod; readonly value: number }
  | { readonly kind: 'invalid_warn_fraction'; readonly value: number }
  | { readonly kind: 'invalid_month'; readonly value: string }
