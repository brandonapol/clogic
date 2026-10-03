import { budgetStatuses, checkBudget, rollMonth, recordSpend } from '../usage/budget.js'
import { estimateCost, recordCall, tokenUsage } from '../usage/estimate.js'
import { formatBudgetDecision } from '../usage/format.js'
import type { BudgetDecision, BudgetPeriod, BudgetState } from '../usage/types.js'
import type { ChatResponse } from '../llm/types.js'
import type { AgentNotification, AgentState } from './types.js'

export const withBudgetMonth = (state: AgentState, month: string): AgentState =>
  state.budget === null || state.budget.month === month
    ? state
    : { ...state, budget: rollMonth(state.budget, month) }

export const budgetBlock = (state: AgentState): AgentNotification | undefined => {
  if (state.budget === null) return undefined
  const decision = checkBudget(state.budget, state.budget.month)
  const message = decision.kind === 'block' ? formatBudgetDecision(decision) : null
  return message === null ? undefined : { type: 'budget', level: 'block', message }
}

const alertFor = (
  budget: BudgetState,
  kind: 'warn' | 'block',
  periods: readonly BudgetPeriod[],
): readonly AgentNotification[] => {
  const statuses = budgetStatuses(budget).filter((status) => periods.includes(status.period))
  const decision: BudgetDecision = { kind, statuses }
  const message = statuses.length === 0 ? null : formatBudgetDecision(decision)
  return message === null ? [] : [{ type: 'budget', level: kind, message }]
}

export type Accounted = {
  readonly state: AgentState
  readonly notifications: readonly AgentNotification[]
}

export const accountUsage = (
  state: AgentState,
  response: ChatResponse,
  turnEnds: boolean,
): Accounted => {
  const call = tokenUsage(response.usage)
  const estimate = estimateCost(
    state.config.prices,
    response.replay.provider,
    state.config.model,
    call,
  )
  const total = recordCall(state.usage, call, estimate)
  const usage: AgentNotification = { type: 'usage', call, estimate, total }
  if (state.budget === null) return { state: { ...state, usage: total }, notifications: [usage] }
  const update = recordSpend(state.budget, estimate, state.budget.month)
  return {
    state: { ...state, usage: total, budget: update.state },
    notifications: [
      usage,
      ...alertFor(update.state, 'warn', update.newlyWarned),
      ...(turnEnds ? alertFor(update.state, 'block', update.newlyBlocked) : []),
    ],
  }
}
