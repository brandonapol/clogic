import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeConversation } from '../../src/history/codec.js'
import { createHistoryStore } from '../../src/history/store.js'
import { anthropicLike, conversation, user } from './fixtures.js'

let root: string
let baseDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clogic-history-'))
  baseDir = join(root, 'history')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const mode = async (path: string) => (await stat(path)).mode & 0o777

describe('createHistoryStore', () => {
  it('saves and loads a conversation', async () => {
    const store = createHistoryStore({ baseDir })
    const record = conversation([user('hello')])
    expect(await store.save(record)).toEqual({ ok: true, value: undefined })
    expect(await store.load('instance-1')).toEqual({ ok: true, value: record })
  })

  it('returns null for a conversation that does not exist', async () => {
    expect(await createHistoryStore({ baseDir }).load('missing')).toEqual({ ok: true, value: null })
  })

  it('writes files readable only by the owner in a private directory', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation())
    expect(await mode(join(baseDir, 'instance-1.json'))).toBe(0o600)
    expect(await mode(baseDir)).toBe(0o700)
  })

  it('tightens permissions when overwriting a looser existing file', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation())
    const path = join(baseDir, 'instance-1.json')
    await writeFile(path, '{}', { mode: 0o644 })
    await store.save(conversation([user('again')]))
    expect(await mode(path)).toBe(0o600)
  })

  it('replaces the file atomically and leaves no temp files', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation([user('one')]))
    await store.save(conversation([user('one'), user('two')]))
    expect(await readdir(baseDir)).toEqual(['instance-1.json'])
    const loaded = await store.load('instance-1')
    expect(loaded.ok && loaded.value?.messages.length).toBe(2)
  })

  it('keeps the previous file when encoding fails', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation([user('kept')]))
    const before = await readFile(join(baseDir, 'instance-1.json'), 'utf8')
    const failing = createHistoryStore({
      baseDir,
      secrets: () => {
        throw new Error('keychain unavailable')
      },
    })
    expect(await failing.save(conversation([user('lost')]))).toEqual({
      ok: false,
      error: { kind: 'io', message: 'keychain unavailable' },
    })
    expect(await readFile(join(baseDir, 'instance-1.json'), 'utf8')).toBe(before)
    expect(await readdir(baseDir)).toEqual(['instance-1.json'])
  })

  it('removes the temp file when the final rename fails', async () => {
    await mkdir(join(baseDir, 'instance-1.json'), { recursive: true })
    const result = await createHistoryStore({ baseDir }).save(conversation())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('io')
    expect(await readdir(baseDir)).toEqual(['instance-1.json'])
  })

  it('never persists API keys', async () => {
    const key = anthropicLike()
    const store = createHistoryStore({ baseDir, secrets: () => ['placeholder-secret'] })
    await store.save(conversation([user(`${key} and placeholder-secret`)]))
    const text = await readFile(join(baseDir, 'instance-1.json'), 'utf8')
    expect(text).not.toContain(key)
    expect(text).not.toContain('placeholder-secret')
  })

  it('reports a corrupt file instead of throwing', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation())
    await writeFile(join(baseDir, 'instance-1.json'), '{"version": 2, "id": "inst')
    const result = await store.load('instance-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ kind: 'corrupt', id: 'instance-1' })
  })

  it('treats a record stored under the wrong file name as corrupt', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation())
    const other = encodeConversation(conversation([], { id: 'someone-else' }))
    await writeFile(join(baseDir, 'instance-1.json'), other)
    const result = await store.load('instance-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('corrupt')
  })

  it('lists conversations newest first and reports corrupt files separately', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation([], { id: 'older', updatedAt: 1 }))
    await store.save(conversation([user('x')], { id: 'newer', updatedAt: 2 }))
    await writeFile(join(baseDir, 'broken.json'), 'not json')
    await writeFile(join(baseDir, '.leftover.tmp'), 'partial')
    await writeFile(join(baseDir, 'notes.txt'), 'ignored')
    const result = await store.list()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.conversations.map((summary) => summary.id)).toEqual(['newer', 'older'])
    expect(result.value.corrupt.map((entry) => entry.id)).toEqual(['broken'])
  })

  it('lists nothing when the directory does not exist yet', async () => {
    expect(await createHistoryStore({ baseDir }).list()).toEqual({
      ok: true,
      value: { conversations: [], corrupt: [] },
    })
  })

  it('deletes conversations', async () => {
    const store = createHistoryStore({ baseDir })
    await store.save(conversation())
    expect(await store.remove('instance-1')).toEqual({ ok: true, value: true })
    expect(await store.remove('instance-1')).toEqual({ ok: true, value: false })
    expect(await store.load('instance-1')).toEqual({ ok: true, value: null })
  })

  it.each(['../escape', 'a/b', '', '.hidden', 'x'.repeat(200)])(
    'rejects unsafe id %#',
    async (id) => {
      const store = createHistoryStore({ baseDir })
      expect(await store.save(conversation([], { id }))).toEqual({
        ok: false,
        error: { kind: 'invalid_id', id },
      })
      expect(await store.load(id)).toEqual({ ok: false, error: { kind: 'invalid_id', id } })
      expect(await store.remove(id)).toEqual({ ok: false, error: { kind: 'invalid_id', id } })
    },
  )

  it('refuses to write inside a Logic project bundle', async () => {
    const inside = join(root, 'My Song.logicx', 'history')
    const store = createHistoryStore({ baseDir: inside })
    const result = await store.save(conversation())
    expect(result).toEqual({ ok: false, error: { kind: 'invalid_base_dir', baseDir: inside } })
    expect(await readdir(root)).toEqual([])
  })

  it('reports io failures as values', async () => {
    const file = join(root, 'not-a-dir')
    await writeFile(file, '')
    const result = await createHistoryStore({ baseDir: file }).save(conversation())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('io')
  })
})
