import { describe, expect, it } from 'vitest'
import { compact, estimateRecordTokens, estimateTokens } from '../../src/history/compact.js'
import { assistant, conversation, proposal, toolResults, user } from './fixtures.js'

const long = (label: string) => `${label} ${'a'.repeat(400)}`

const turns = [
  user(long('first')),
  assistant(long('reply one')),
  user(long('second')),
  assistant(long('reply two'), ['c2']),
  toolResults(['c2']),
  assistant(long('after tool')),
  user(long('third')),
  assistant(long('reply three')),
]

describe('estimateTokens', () => {
  it('estimates four characters per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('compact', () => {
  it('leaves a record within budget untouched', () => {
    const record = conversation(turns)
    const result = compact(record, { maxTokens: estimateRecordTokens(record) })
    expect(result).toEqual({
      record,
      dropped: 0,
      estimatedTokens: estimateRecordTokens(record),
      withinBudget: true,
    })
  })

  it('drops the oldest whole turns and keeps history starting at a user message', () => {
    const record = conversation(turns)
    const result = compact(record, { maxTokens: estimateRecordTokens(record) - 10 })
    expect(result.dropped).toBe(2)
    expect(result.record.messages[0]).toEqual(turns[2])
    expect(result.record.droppedMessages).toBe(2)
    expect(result.withinBudget).toBe(true)
    expect(result.estimatedTokens).toBe(estimateRecordTokens(result.record))
    expect(result.estimatedTokens).toBeLessThanOrEqual(estimateRecordTokens(record) - 10)
  })

  it('never splits a tool call from its results', () => {
    const record = conversation(turns)
    const result = compact(record, { maxTokens: 400 })
    expect(result.record.messages).toEqual(turns.slice(6))
  })

  it('always keeps the system prompt, even when it alone exceeds the budget', () => {
    const record = conversation(turns, { system: 'x'.repeat(4000) })
    const result = compact(record, { maxTokens: 100 })
    expect(result.record.system).toBe(record.system)
    expect(result.record.messages).toEqual(turns.slice(6))
    expect(result.withinBudget).toBe(false)
  })

  it('keeps pending proposals and the turn that raised them', () => {
    const pendingTurns = turns.slice(0, 4)
    const record = conversation([...pendingTurns, user(long('later'))], {
      pendingProposals: [proposal('c2')],
    })
    const result = compact(record, { maxTokens: 50 })
    expect(result.record.pendingProposals).toEqual([proposal('c2')])
    expect(result.record.messages[0]).toEqual(turns[2])
    expect(result.record.messages).toContainEqual(turns[3])
    expect(result.withinBudget).toBe(false)
  })

  it('accumulates dropped counts across compactions', () => {
    const record = conversation(turns, { droppedMessages: 5 })
    expect(compact(record, { maxTokens: 400 }).record.droppedMessages).toBe(11)
  })

  it('reports over budget when there is nothing it may drop', () => {
    const record = conversation([user(long('only'))])
    const result = compact(record, { maxTokens: 1 })
    expect(result.record).toBe(record)
    expect(result.dropped).toBe(0)
    expect(result.withinBudget).toBe(false)
  })
})
