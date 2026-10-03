import { err, ok, type Result } from '../llm/result.js'
import type {
  BudgetConfigError,
  BudgetDecision,
  BudgetLimits,
  BudgetPeriod,
  BudgetState,
  BudgetStatus,
  BudgetUpdate,
  CostEstimate,
} from './types.js'

export const defaultWarnFraction = 0.8

export type BudgetLimitsInput = {
  readonly sessionUsd: number | null
  readonly monthlyUsd: number | null
  readonly warnFraction?: number
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/

export const monthKey = (epochMs: number): string => {
  const date = new Date(epochMs)
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const validLimit = (value: number | null): boolean =>
  value === null || (Number.isFinite(value) && value > 0)

export const validateLimits = (
  input: BudgetLimitsInput,
): Result<BudgetLimits, BudgetConfigError> => {
  const warnFraction = input.warnFraction ?? defaultWarnFraction
  if (!validLimit(input.sessionUsd))
    return err({ kind: 'invalid_limit', period: 'session', value: input.sessionUsd ?? 0 })
  if (!validLimit(input.monthlyUsd))
    return err({ kind: 'invalid_limit', period: 'month', value: input.monthlyUsd ?? 0 })
  if (!Number.isFinite(warnFraction) || warnFraction <= 0 || warnFraction >= 1)
    return err({ kind: 'invalid_warn_fraction', value: warnFraction })
  return ok({ sessionUsd: input.sessionUsd, monthlyUsd: input.monthlyUsd, warnFraction })
}

export const createBudget = (
  input: BudgetLimitsInput,
  month: string,
  monthSpentUsd = 0,
): Result<BudgetState, BudgetConfigError> => {
  if (!monthPattern.test(month)) return err({ kind: 'invalid_month', value: month })
  const limits = validateLimits(input)
  if (!limits.ok) return limits
  return ok({
    limits: limits.value,
    month,
    sessionSpentUsd: 0,
    monthSpentUsd: Math.max(0, monthSpentUsd),
    unpricedCalls: 0,
  })
}

export const setLimits = (
  state: BudgetState,
  input: BudgetLimitsInput,
): Result<BudgetState, BudgetConfigError> => {
  const limits = validateLimits(input)
  return limits.ok ? ok({ ...state, limits: limits.value }) : limits
}

export const resetSession = (state: BudgetState): BudgetState => ({
  ...state,
  sessionSpentUsd: 0,
  unpricedCalls: 0,
})

export const rollMonth = (state: BudgetState, month: string): BudgetState =>
  state.month === month ? state : { ...state, month, monthSpentUsd: 0 }

const status = (period: BudgetPeriod, spentUsd: number, limitUsd: number | null) =>
  limitUsd === null ? [] : [{ period, spentUsd, limitUsd, fraction: spentUsd / limitUsd }]

export const budgetStatuses = (state: BudgetState): readonly BudgetStatus[] => [
  ...status('session', state.sessionSpentUsd, state.limits.sessionUsd),
  ...status('month', state.monthSpentUsd, state.limits.monthlyUsd),
]

const decide = (state: BudgetState): BudgetDecision => {
  const statuses = budgetStatuses(state)
  const blocked = statuses.filter((s) => s.fraction >= 1)
  if (blocked.length > 0) return { kind: 'block', statuses: blocked }
  const warned = statuses.filter((s) => s.fraction >= state.limits.warnFraction)
  if (warned.length > 0) return { kind: 'warn', statuses: warned }
  return { kind: 'allow' }
}

export const checkBudget = (state: BudgetState, month: string): BudgetDecision =>
  decide(rollMonth(state, month))

const fractionOf = (state: BudgetState, period: BudgetPeriod): number =>
  budgetStatuses(state).find((s) => s.period === period)?.fraction ?? 0

const crossed = (
  before: BudgetState,
  after: BudgetState,
  lower: number,
  upper: number,
): readonly BudgetPeriod[] =>
  (['session', 'month'] as const).filter((period) => {
    const now = fractionOf(after, period)
    return fractionOf(before, period) < lower && now >= lower && now < upper
  })

export const recordSpend = (
  state: BudgetState,
  estimate: CostEstimate,
  month: string,
): BudgetUpdate => {
  const before = rollMonth(state, month)
  const usd = estimate.kind === 'priced' ? Math.max(0, estimate.usd) : 0
  const after: BudgetState = {
    ...before,
    sessionSpentUsd: before.sessionSpentUsd + usd,
    monthSpentUsd: before.monthSpentUsd + usd,
    unpricedCalls: before.unpricedCalls + (estimate.kind === 'priced' ? 0 : 1),
  }
  return {
    state: after,
    decision: decide(after),
    newlyWarned: crossed(before, after, after.limits.warnFraction, 1),
    newlyBlocked: crossed(before, after, 1, Number.POSITIVE_INFINITY),
  }
}
