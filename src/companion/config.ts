import { adapters } from '../llm/providers.js'
import { err, ok, type Result } from '../llm/result.js'
import type { ProviderId } from '../llm/types.js'
import { buildSystemPrompt, promptTools } from '../prompts/system.js'
import type { Tool } from '../tools/types.js'
import { defaultWarnFraction, type BudgetLimitsInput } from '../usage/budget.js'
import { defaultPriceTable } from '../usage/prices.js'
import type { CompanionSettings } from './types.js'

export const companionName = 'clogic-companion 0.0.0'

export const systemPromptFor =
  (tools: readonly Tool[]) =>
  (provider: ProviderId): string =>
    buildSystemPrompt({ provider, tools: promptTools(tools) })

export const defaultModels: Readonly<Record<ProviderId, string>> = {
  anthropic: adapters.anthropic.defaultModel,
  openai: adapters.openai.defaultModel,
  xai: adapters.xai.defaultModel,
}

export const defaultBudgetLimits: BudgetLimitsInput = {
  sessionUsd: 5,
  monthlyUsd: 50,
  warnFraction: defaultWarnFraction,
}

export const budgetEnvVars = {
  sessionUsd: 'CLOGIC_BUDGET_SESSION_USD',
  monthlyUsd: 'CLOGIC_BUDGET_MONTHLY_USD',
} as const

const disabledWords: ReadonlySet<string> = new Set(['off', 'none', 'unlimited'])

const parseLimit = (
  name: string,
  raw: string | undefined,
  fallback: number | null,
): Result<number | null, string> => {
  const value = raw?.trim() ?? ''
  if (value.length === 0) return ok(fallback)
  if (disabledWords.has(value.toLowerCase())) return ok(null)
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0
    ? ok(amount)
    : err(`${name} must be a positive amount in US dollars or "off"`)
}

export const budgetFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
  base: BudgetLimitsInput = defaultBudgetLimits,
): Result<BudgetLimitsInput, string> => {
  const sessionUsd = parseLimit(
    budgetEnvVars.sessionUsd,
    env[budgetEnvVars.sessionUsd],
    base.sessionUsd,
  )
  if (!sessionUsd.ok) return sessionUsd
  const monthlyUsd = parseLimit(
    budgetEnvVars.monthlyUsd,
    env[budgetEnvVars.monthlyUsd],
    base.monthlyUsd,
  )
  if (!monthlyUsd.ok) return monthlyUsd
  return ok({ ...base, sessionUsd: sessionUsd.value, monthlyUsd: monthlyUsd.value })
}

export type SettingsOverrides = Partial<Omit<CompanionSettings, 'tools'>>

export const companionSettings = (
  tools: readonly Tool[],
  overrides: SettingsOverrides = {},
): CompanionSettings => ({
  system: systemPromptFor(tools),
  maxOutputTokens: 4096,
  maxIterations: 8,
  proposalTtlMs: 5 * 60_000,
  models: defaultModels,
  prices: defaultPriceTable,
  budget: defaultBudgetLimits,
  ...overrides,
  tools: tools.map((tool) => ({ definition: tool.definition, kind: tool.kind })),
})
