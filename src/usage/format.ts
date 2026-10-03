import type { BudgetDecision, BudgetPeriod, BudgetStatus, UsageLedger } from './types.js'

const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const trimmed = (value: number): string => {
  const fixed = value.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

export const formatTokenCount = (count: number): string => {
  const n = Math.max(0, Math.round(count))
  if (n < 1_000) return String(n)
  if (n < 999_950) return `${trimmed(n / 1_000)}k`
  return `${trimmed(n / 1_000_000)}M`
}

export const formatUsd = (usd: number): string => {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  const [whole = '0', cents = '00'] = usd.toFixed(2).split('.')
  return `$${groupThousands(whole)}.${cents}`
}

const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? '' : 's'}`

export const formatTokens = (ledger: UsageLedger): string => {
  const input = `${formatTokenCount(ledger.inputTokens + ledger.cachedInputTokens)} in`
  const cached =
    ledger.cachedInputTokens > 0 ? ` (${formatTokenCount(ledger.cachedInputTokens)} cached)` : ''
  return `${input}${cached} · ${formatTokenCount(ledger.outputTokens)} out`
}

export const formatCost = (ledger: UsageLedger): string => {
  if (ledger.unpricedCalls === 0) return formatUsd(ledger.pricedUsd)
  const names = ledger.unpricedModels.map((m) => m.model).join(', ')
  if (ledger.unpricedCalls === ledger.calls) return `cost unknown (no price for ${names})`
  return `at least ${formatUsd(ledger.pricedUsd)} (${plural(ledger.unpricedCalls, 'call')} unpriced: ${names})`
}

export const formatUsage = (ledger: UsageLedger): string =>
  ledger.calls === 0 ? 'No tokens used yet' : `${formatTokens(ledger)} · ${formatCost(ledger)}`

const periodLabel: Readonly<Record<BudgetPeriod, string>> = {
  session: 'Session',
  month: 'Monthly',
}

const percent = (fraction: number): string => `${String(Math.floor(fraction * 100))}%`

export const formatBudgetStatus = (status: BudgetStatus): string =>
  `${periodLabel[status.period]} budget ${percent(status.fraction)} used (${formatUsd(status.spentUsd)} of ${formatUsd(status.limitUsd)})`

export const formatBudgetDecision = (decision: BudgetDecision): string | null => {
  switch (decision.kind) {
    case 'allow':
      return null
    case 'warn':
      return decision.statuses.map(formatBudgetStatus).join('. ')
    case 'block':
      return `${decision.statuses
        .map(
          (s) =>
            `${periodLabel[s.period]} budget reached (${formatUsd(s.spentUsd)} of ${formatUsd(s.limitUsd)})`,
        )
        .join('. ')}. Raise or remove the limit to keep chatting.`
  }
}
