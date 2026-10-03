import type { Message } from '../llm/types.js'
import type { ConversationRecord, PendingProposal } from './types.js'

export const charsPerToken = 4

export type CompactionPolicy = {
  readonly maxTokens: number
}

export type CompactionResult = {
  readonly record: ConversationRecord
  readonly dropped: number
  readonly estimatedTokens: number
  readonly withinBudget: boolean
}

export const estimateTokens = (text: string): number => Math.ceil(text.length / charsPerToken)

const messageTokens = (message: Message): number => estimateTokens(JSON.stringify(message))

const proposalTokens = (proposal: PendingProposal): number =>
  estimateTokens(JSON.stringify(proposal))

const fixedTokens = (record: ConversationRecord): number =>
  record.pendingProposals.reduce(
    (sum, proposal) => sum + proposalTokens(proposal),
    estimateTokens(record.system),
  )

export const estimateRecordTokens = (record: ConversationRecord): number =>
  record.messages.reduce((sum, message) => sum + messageTokens(message), fixedTokens(record))

const firstProtectedIndex = (record: ConversationRecord): number => {
  const callIds = new Set(record.pendingProposals.map((proposal) => proposal.callId))
  const index = record.messages.findIndex(
    (message) =>
      message.role === 'assistant' && message.toolCalls.some((call) => callIds.has(call.id)),
  )
  return index === -1 ? record.messages.length : index
}

const suffixTokens = (messages: readonly Message[]): readonly number[] =>
  messages.reduceRight<readonly number[]>(
    (acc, message) => [messageTokens(message) + (acc[0] ?? 0), ...acc],
    [0],
  )

const cutPoints = (messages: readonly Message[], limit: number): readonly number[] =>
  messages.flatMap((message, index) =>
    index > 0 && index <= limit && message.role === 'user' ? [index] : [],
  )

export const compact = (record: ConversationRecord, policy: CompactionPolicy): CompactionResult => {
  const fixed = fixedTokens(record)
  const suffix = suffixTokens(record.messages)
  const total = (cut: number) => fixed + (suffix[cut] ?? 0)
  if (total(0) <= policy.maxTokens)
    return { record, dropped: 0, estimatedTokens: total(0), withinBudget: true }
  const cuts = cutPoints(record.messages, firstProtectedIndex(record))
  const fitting = cuts.find((cut) => total(cut) <= policy.maxTokens)
  const cut = fitting ?? cuts[cuts.length - 1] ?? 0
  return {
    record:
      cut === 0
        ? record
        : {
            ...record,
            messages: record.messages.slice(cut),
            droppedMessages: record.droppedMessages + cut,
          },
    dropped: cut,
    estimatedTokens: total(cut),
    withinBudget: fitting !== undefined,
  }
}
