import { describe, expect, it } from 'vitest'
import {
  addPendingProposal,
  appendMessage,
  createConversation,
  resolvePendingProposal,
  summarize,
} from '../../src/history/record.js'
import { conversation, proposal, user } from './fixtures.js'

describe('createConversation', () => {
  it('starts an empty current-version record', () => {
    expect(createConversation({ id: 'abc', system: 'sys', at: 10 })).toEqual({
      version: 2,
      id: 'abc',
      projectName: null,
      contextName: null,
      createdAt: 10,
      updatedAt: 10,
      system: 'sys',
      messages: [],
      pendingProposals: [],
      droppedMessages: 0,
    })
  })
})

describe('appendMessage', () => {
  it('appends without mutating and advances updatedAt', () => {
    const record = conversation([user('one')])
    const next = appendMessage(record, user('two'), 2000)
    expect(next.messages).toEqual([user('one'), user('two')])
    expect(next.updatedAt).toBe(2000)
    expect(record.messages).toEqual([user('one')])
  })

  it('never moves updatedAt backwards', () => {
    expect(appendMessage(conversation(), user('x'), 1).updatedAt).toBe(1000)
  })
})

describe('pending proposals', () => {
  it('adds, replaces by id and resolves', () => {
    const added = addPendingProposal(conversation(), proposal('c1'), 1100)
    const replaced = addPendingProposal(added, { ...proposal('c1'), expiresAt: 9 }, 1200)
    expect(replaced.pendingProposals).toEqual([{ ...proposal('c1'), expiresAt: 9 }])
    expect(resolvePendingProposal(replaced, 'proposal-c1', 1300).pendingProposals).toEqual([])
  })
})

describe('summarize', () => {
  it('describes a record for listing', () => {
    expect(summarize(conversation([user('hi')]))).toEqual({
      id: 'instance-1',
      projectName: 'Song',
      contextName: 'Vox',
      updatedAt: 1000,
      messageCount: 1,
    })
  })
})
