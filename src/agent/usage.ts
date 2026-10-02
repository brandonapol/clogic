import type { Usage } from '../llm/types.js'
import type { Pricing, UsageTotals } from './types.js'

export const emptyUsage = (pricing: Pricing | null): UsageTotals => ({
  llmCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: pricing === null ? null : 0,
})

export const costOf = (usage: Usage, pricing: Pricing): number =>
  (usage.inputTokens * pricing.inputUsdPerMillion +
    usage.outputTokens * pricing.outputUsdPerMillion) /
  1_000_000

export const addUsage = (
  totals: UsageTotals,
  usage: Usage,
  pricing: Pricing | null,
): UsageTotals => ({
  llmCalls: totals.llmCalls + 1,
  inputTokens: totals.inputTokens + usage.inputTokens,
  outputTokens: totals.outputTokens + usage.outputTokens,
  costUsd:
    pricing === null || totals.costUsd === null ? null : totals.costUsd + costOf(usage, pricing),
})
