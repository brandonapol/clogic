import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatLine } from '../../src/log/format.js'
import { createFileSink, createStderrSink } from '../../src/log/sinks.js'
import type { Sink } from '../../src/log/types.js'
import { record } from './fixtures.js'

let root: string
let dir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clogic-log-'))
  dir = join(root, 'logs')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const mode = async (path: string) => (await stat(path)).mode & 0o777

const fileSink = (options: Partial<Parameters<typeof createFileSink>[0]> = {}): Sink => {
  const created = createFileSink({ dir, ...options })
  if (!created.ok) throw new Error(created.error.kind)
  return created.value
}

const contentRecord = record({ fields: { text: 'private lyric idea', tempo: 92 } })

describe('formatLine', () => {
  it('writes one JSON line with an ISO time and no content by default', () => {
    const line = formatLine(contentRecord)
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      time: '2026-10-03T12:00:00.000Z',
      level: 'info',
      event: 'test.event',
      context: {},
      fields: { text: '[CONTENT OMITTED]', tempo: 92 },
    })
  })
})

describe('createStderrSink', () => {
  it('writes formatted lines through the injected writer without content', () => {
    const lines: string[] = []
    createStderrSink({ write: (line) => lines.push(line) })(contentRecord)
    expect(lines).toEqual([formatLine(contentRecord)])
    expect(lines.join('')).not.toContain('lyric')
  })

  it('includes content only when configured', () => {
    const lines: string[] = []
    createStderrSink({ write: (line) => lines.push(line), includeContent: true })(contentRecord)
    expect(lines.join('')).toContain('lyric')
  })
})

describe('createFileSink', () => {
  it('writes owner-only files in an owner-only directory', async () => {
    fileSink()(record())
    expect(await mode(dir)).toBe(0o700)
    expect(await mode(join(dir, 'clogic.log'))).toBe(0o600)
    expect(await readFile(join(dir, 'clogic.log'), 'utf8')).toBe(formatLine(record()))
  })

  it('omits content from files by default', async () => {
    fileSink()(contentRecord)
    expect(await readFile(join(dir, 'clogic.log'), 'utf8')).not.toContain('lyric')
  })

  it('rotates when a file would exceed maxBytes and keeps at most maxFiles', async () => {
    const lineBytes = Buffer.byteLength(formatLine(record({ event: 'e.0' })))
    const sink = fileSink({ maxBytes: lineBytes * 2, maxFiles: 3 })
    Array.from({ length: 9 }, (_, index) => sink(record({ event: `e.${index}` })))
    expect((await readdir(dir)).sort()).toEqual(['clogic.log', 'clogic.log.1', 'clogic.log.2'])
    const events = async (name: string) =>
      (await readFile(join(dir, name), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { event: string }).event)
    expect(await events('clogic.log')).toEqual(['e.8'])
    expect(await events('clogic.log.1')).toEqual(['e.6', 'e.7'])
    expect(await events('clogic.log.2')).toEqual(['e.4', 'e.5'])
    await Promise.all(
      ['clogic.log', 'clogic.log.1', 'clogic.log.2'].map(async (name) =>
        expect(await mode(join(dir, name))).toBe(0o600),
      ),
    )
  })

  it('truncates in place when only one file is allowed', async () => {
    const lineBytes = Buffer.byteLength(formatLine(record({ event: 'e.0' })))
    const sink = fileSink({ maxBytes: lineBytes, maxFiles: 1 })
    sink(record({ event: 'e.0' }))
    sink(record({ event: 'e.1' }))
    expect(await readdir(dir)).toEqual(['clogic.log'])
    expect(await readFile(join(dir, 'clogic.log'), 'utf8')).toContain('e.1')
  })

  it('refuses relative directories, Logic bundles and unsafe names', () => {
    expect(createFileSink({ dir: 'logs' })).toEqual({
      ok: false,
      error: { kind: 'invalid_dir', dir: 'logs' },
    })
    const bundle = join(root, 'Song.logicx', 'logs')
    expect(createFileSink({ dir: bundle })).toEqual({
      ok: false,
      error: { kind: 'invalid_dir', dir: bundle },
    })
    expect(createFileSink({ dir, fileName: '../escape.log' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_file_name' },
    })
    expect(createFileSink({ dir, maxBytes: 0 })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_limits' },
    })
  })

  it('reports write failures instead of throwing', async () => {
    const errors: string[] = []
    const blocked = join(root, 'blocked')
    await writeFile(blocked, 'not a dir')
    const created = createFileSink({ dir: blocked, onError: (message) => errors.push(message) })
    if (!created.ok) throw new Error(created.error.kind)
    expect(() => created.value(record())).not.toThrow()
    expect(errors).toHaveLength(1)
  })
})
