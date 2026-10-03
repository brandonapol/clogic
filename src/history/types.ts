import type { Message } from '../llm/types.js'
import type { ChangeRow } from '../tools/types.js'

export const currentVersion = 2 as const

export type PendingProposal = {
  readonly id: string
  readonly callId: string
  readonly toolName: string
  readonly rows: readonly ChangeRow[]
  readonly expiresAt: number
}

export type ConversationRecord = {
  readonly version: typeof currentVersion
  readonly id: string
  readonly projectName: string | null
  readonly contextName: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly system: string
  readonly messages: readonly Message[]
  readonly pendingProposals: readonly PendingProposal[]
  readonly droppedMessages: number
}

export type ConversationSummary = {
  readonly id: string
  readonly projectName: string | null
  readonly contextName: string | null
  readonly updatedAt: number
  readonly messageCount: number
}

export type DecodeError =
  | { readonly kind: 'invalid_json'; readonly message: string }
  | { readonly kind: 'invalid_record'; readonly message: string }
  | { readonly kind: 'unsupported_version'; readonly version: unknown }
