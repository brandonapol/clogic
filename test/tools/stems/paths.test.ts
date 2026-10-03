import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { statPath, validatePath, type StatPath } from '../../../src/tools/stems/index.js'

const never: StatPath = async (path) => {
  throw new Error(`stat called for ${path}`)
}

const invalid = (message: string) => ({ ok: false, error: { kind: 'invalid_input', message } })

describe('validatePath', () => {
  it('rejects empty and relative paths without touching the file system', async () => {
    expect(await validatePath('folder', '  ', 'directory', never)).toEqual(
      invalid('folder must not be empty'),
    )
    expect(await validatePath('folder', 'stems', 'directory', never)).toEqual(
      invalid('folder must be absolute, got stems'),
    )
  })

  it('rejects non-audio files before looking at them', async () => {
    const result = await validatePath('mix', '/songs/notes.txt', 'audio-file', never)
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid_input' } })
    expect(result.ok ? '' : result.error.message).toContain('mix must be an audio file (.wav')
  })

  it('rejects hidden audio files', async () => {
    const result = await validatePath('mix', '/songs/._mix.wav', 'audio-file', never)
    expect(result.ok).toBe(false)
  })

  it('normalises the path and reports missing paths', async () => {
    const seen: string[] = []
    const stat: StatPath = async (path) => {
      seen.push(path)
      return 'missing'
    }
    expect(await validatePath('mix', '/songs/a/../mix.WAV', 'audio-file', stat)).toEqual(
      invalid('mix does not exist: /songs/mix.WAV'),
    )
    expect(seen).toEqual(['/songs/mix.WAV'])
  })

  it('checks the path is the expected kind', async () => {
    expect(await validatePath('folder', '/songs/mix.wav', 'directory', async () => 'file')).toEqual(
      invalid('folder must be a folder, but /songs/mix.wav is a file'),
    )
    expect(
      await validatePath('mix', '/songs/mix.wav', 'audio-file', async () => 'directory'),
    ).toEqual(invalid('mix must be an audio file, but /songs/mix.wav is a folder'))
    expect(await validatePath('folder', '/dev/null', 'directory', async () => 'other')).toEqual(
      invalid('folder must be a folder, but /dev/null is not a regular file or folder'),
    )
  })

  it('accepts existing paths of the right kind', async () => {
    expect(await validatePath('folder', '/stems/', 'directory', async () => 'directory')).toEqual({
      ok: true,
      value: '/stems/',
    })
    expect(await validatePath('mix', '/songs/mix.aiff', 'audio-file', async () => 'file')).toEqual({
      ok: true,
      value: '/songs/mix.aiff',
    })
  })
})

describe('statPath', () => {
  let dir = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clogic-stems-'))
    await writeFile(join(dir, 'kick.wav'), '')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('classifies files, folders and missing paths', async () => {
    expect(await statPath(dir)).toBe('directory')
    expect(await statPath(join(dir, 'kick.wav'))).toBe('file')
    expect(await statPath(join(dir, 'missing.wav'))).toBe('missing')
  })
})
