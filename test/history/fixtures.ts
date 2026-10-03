import type { Message } from '../../src/llm/types.js'
import { createConversation } from '../../src/history/record.js'
import type { ConversationRecord, PendingProposal } from '../../src/history/types.js'

export const fakeKey = (prefix: string): string => [prefix, 'x'.repeat(16)].join('')

export const anthropicLike = (): string => fakeKey(['sk', 'ant', ''].join('-'))
export const openAiLike = (): string => fakeKey(['sk', 'proj', ''].join('-'))
export const xaiLike = (): string => fakeKey(['xai', ''].join('-'))

export const user = (text: string): Message => ({ role: 'user', text })

export const assistant = (text: string, callIds: readonly string[] = []): Message => ({
  role: 'assistant',
  text,
  toolCalls: callIds.map((id) => ({ id, name: 'set_fader_db', input: { track: 'Vox', db: -6 } })),
})

export const toolResults = (callIds: readonly string[]): Message => ({
  role: 'tool',
  results: callIds.map((callId) => ({ callId, content: 'ok', isError: false })),
})

export const proposal = (callId: string): PendingProposal => ({
  id: `proposal-${callId}`,
  callId,
  toolName: 'set_fader_db',
  rows: [{ id: 'row-1', control: 'fader', location: 'Vox', before: -3, after: -6 }],
  expiresAt: 5000,
})

export const conversation = (
  messages: readonly Message[] = [],
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord => ({
  ...createConversation({
    id: 'instance-1',
    system: 'You are a mixing assistant.',
    at: 1000,
    projectName: 'Song',
    contextName: 'Vox',
  }),
  messages,
  ...overrides,
})
