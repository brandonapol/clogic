import { describe, expect, it } from 'vitest'
import {
  budgetStatuses,
  checkBudget,
  createBudget,
  monthKey,
  recordSpend,
  resetSession,
  setLimits,
} from '../../src/usage/budget.js'
import type { BudgetState, CostEstimate } from '../../src/usage/types.js'
import { defaultPriceTable } from '../../src/usage/prices.js'

const price = defaultPriceTable[0]
if (price === undefined) throw new Error('missing price')

const spend = (usd: number): CostEstimate => ({ kind: 'priced', usd, tier: 'standard', price })
const unknown: CostEstimate = { kind: 'unknown_model', provider: 'xai', model: 'grok-9' }

const budget = (sessionUsd: number | null, monthlyUsd: number | null, spent = 0): BudgetState => {
  const result = createBudget({ sessionUsd, monthlyUsd }, '2026-10', spent)
  if (!result.ok) throw new Error(result.error.kind)
  return result.value
}

const spendAll = (state: BudgetState, amounts: readonly number[], month = '2026-10') =>
  amounts.reduce((s, usd) => recordSpend(s, spend(usd), month).state, state)

describe('monthKey', () => {
  it('formats the UTC year and month', () => {
    expect(monthKey(Date.UTC(2026, 0, 31, 23, 59))).toBe('2026-01')
    expect(monthKey(Date.UTC(2026, 11, 1))).toBe('2026-12')
  })
})

describe('createBudget', () => {
  it('defaults the warning to 80 percent', () => {
    expect(budget(5, 20).limits.warnFraction).toBe(0.8)
  })

  it('rejects zero, negative and non-finite limits as values', () => {
    expect(createBudget({ sessionUsd: 0, monthlyUsd: null }, '2026-10')).toEqual({
      ok: false,
      error: { kind: 'invalid_limit', period: 'session', value: 0 },
    })
    expect(createBudget({ sessionUsd: null, monthlyUsd: -1 }, '2026-10')).toEqual({
      ok: false,
      error: { kind: 'invalid_limit', period: 'month', value: -1 },
    })
    expect(
      createBudget({ sessionUsd: Number.POSITIVE_INFINITY, monthlyUsd: null }, '2026-10').ok,
    ).toBe(false)
  })

  it('rejects a warning fraction outside (0, 1)', () => {
    expect(createBudget({ sessionUsd: 1, monthlyUsd: null, warnFraction: 1 }, '2026-10')).toEqual({
      ok: false,
      error: { kind: 'invalid_warn_fraction', value: 1 },
    })
  })

  it('rejects a malformed month', () => {
    expect(createBudget({ sessionUsd: 1, monthlyUsd: null }, '2026-13')).toEqual({
      ok: false,
      error: { kind: 'invalid_month', value: '2026-13' },
    })
  })
})

describe('budget guard', () => {
  it('allows everything with no limits', () => {
    const state = spendAll(budget(null, null), [1_000])
    expect(checkBudget(state, '2026-10')).toEqual({ kind: 'allow' })
    expect(budgetStatuses(state)).toEqual([])
  })

  it('allows below 80 percent, warns at 80 percent and blocks at 100 percent', () => {
    const state = budget(10, null)
    expect(checkBudget(spendAll(state, [7.99]), '2026-10').kind).toBe('allow')
    expect(checkBudget(spendAll(state, [8]), '2026-10')).toEqual({
      kind: 'warn',
      statuses: [{ period: 'session', spentUsd: 8, limitUsd: 10, fraction: 0.8 }],
    })
    expect(checkBudget(spendAll(state, [10]), '2026-10')).toEqual({
      kind: 'block',
      statuses: [{ period: 'session', spentUsd: 10, limitUsd: 10, fraction: 1 }],
    })
  })

  it('blocks on whichever limit is reached and reports only that one', () => {
    const state = spendAll(budget(100, 20, 19), [1])
    expect(checkBudget(state, '2026-10')).toEqual({
      kind: 'block',
      statuses: [{ period: 'month', spentUsd: 20, limitUsd: 20, fraction: 1 }],
    })
  })

  it('reports newly crossed thresholds once', () => {
    const first = recordSpend(budget(10, null), spend(8.5), '2026-10')
    expect(first.newlyWarned).toEqual(['session'])
    expect(first.newlyBlocked).toEqual([])
    const second = recordSpend(first.state, spend(0.1), '2026-10')
    expect(second.decision.kind).toBe('warn')
    expect(second.newlyWarned).toEqual([])
    const third = recordSpend(second.state, spend(2), '2026-10')
    expect(third.decision.kind).toBe('block')
    expect(third.newlyBlocked).toEqual(['session'])
    expect(third.newlyWarned).toEqual([])
  })

  it('reports a jump straight past 100 percent as blocked, not warned', () => {
    const update = recordSpend(budget(1, null), spend(5), '2026-10')
    expect(update.newlyWarned).toEqual([])
    expect(update.newlyBlocked).toEqual(['session'])
  })

  it('resets the monthly spend when the month changes', () => {
    const state = spendAll(budget(null, 10), [10])
    expect(checkBudget(state, '2026-10').kind).toBe('block')
    expect(checkBudget(state, '2026-11').kind).toBe('allow')
    const next = recordSpend(state, spend(1), '2026-11').state
    expect(next.month).toBe('2026-11')
    expect(next.monthSpentUsd).toBe(1)
  })

  it('resets the session but keeps the monthly spend', () => {
    const state = resetSession(spendAll(budget(5, 10), [5]))
    expect(state.sessionSpentUsd).toBe(0)
    expect(state.monthSpentUsd).toBe(5)
    expect(checkBudget(state, '2026-10').kind).toBe('allow')
  })

  it('counts unpriced calls without inventing spend', () => {
    const update = recordSpend(budget(1, null), unknown, '2026-10')
    expect(update.state.sessionSpentUsd).toBe(0)
    expect(update.state.unpricedCalls).toBe(1)
    expect(update.decision.kind).toBe('allow')
  })

  it('ignores negative spend', () => {
    expect(recordSpend(budget(1, null), spend(-3), '2026-10').state.sessionSpentUsd).toBe(0)
  })

  it('unblocks when the limit is raised', () => {
    const state = spendAll(budget(1, null), [1])
    const raised = setLimits(state, { sessionUsd: 10, monthlyUsd: null })
    expect(raised.ok && checkBudget(raised.value, '2026-10').kind).toBe('allow')
    expect(setLimits(state, { sessionUsd: -1, monthlyUsd: null }).ok).toBe(false)
  })

  it('does not mutate the state it is given', () => {
    const state = budget(1, 1)
    const snapshot = structuredClone(state)
    recordSpend(state, spend(1), '2026-11')
    expect(state).toEqual(snapshot)
  })
})
