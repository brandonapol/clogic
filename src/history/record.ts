import type { Message } from '../llm/types.js'
import {
  currentVersion,
  type ConversationRecord,
  type ConversationSummary,
  type PendingProposal,
} from './types.js'

export type NewConversation = {
  readonly id: string
  readonly system: string
  readonly at: number
  readonly projectName?: string | null
  readonly contextName?: string | null
}

export const createConversation = (input: NewConversation): ConversationRecord => ({
  version: currentVersion,
  id: input.id,
  projectName: input.projectName ?? null,
  contextName: input.contextName ?? null,
  createdAt: input.at,
  updatedAt: input.at,
  system: input.system,
  messages: [],
  pendingProposals: [],
  droppedMessages: 0,
})

export const appendMessage = (
  record: ConversationRecord,
  message: Message,
  at: number,
): ConversationRecord => ({
  ...record,
  messages: [...record.messages, message],
  updatedAt: Math.max(record.updatedAt, at),
})

export const addPendingProposal = (
  record: ConversationRecord,
  proposal: PendingProposal,
  at: number,
): ConversationRecord => ({
  ...record,
  pendingProposals: [
    ...record.pendingProposals.filter((existing) => existing.id !== proposal.id),
    proposal,
  ],
  updatedAt: Math.max(record.updatedAt, at),
})

export const resolvePendingProposal = (
  record: ConversationRecord,
  proposalId: string,
  at: number,
): ConversationRecord => ({
  ...record,
  pendingProposals: record.pendingProposals.filter((proposal) => proposal.id !== proposalId),
  updatedAt: Math.max(record.updatedAt, at),
})

export const summarize = (record: ConversationRecord): ConversationSummary => ({
  id: record.id,
  projectName: record.projectName,
  contextName: record.contextName,
  updatedAt: record.updatedAt,
  messageCount: record.messages.length,
})
