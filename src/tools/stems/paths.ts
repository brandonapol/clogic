import { stat } from 'node:fs/promises'
import { basename, isAbsolute, normalize } from 'node:path'
import { AUDIO_EXTENSIONS, isAudioFileName } from '../../analysis/adapter.js'
import { err, ok, type Result } from '../../llm/result.js'
import type { ToolError } from '../types.js'

export type PathKind = 'file' | 'directory' | 'other' | 'missing'

export type StatPath = (path: string) => Promise<PathKind>

export type ExpectedPath = 'audio-file' | 'directory'

export const statPath: StatPath = async (path) => {
  try {
    const stats = await stat(path)
    if (stats.isFile()) return 'file'
    if (stats.isDirectory()) return 'directory'
    return 'other'
  } catch {
    return 'missing'
  }
}

const invalid = (message: string): Result<never, ToolError> =>
  err({ kind: 'invalid_input', message })

const kindLabel = (kind: PathKind): string =>
  kind === 'other' ? 'not a regular file or folder' : `a ${kind === 'file' ? 'file' : 'folder'}`

export const validatePath = async (
  name: string,
  path: string,
  expected: ExpectedPath,
  statOf: StatPath,
): Promise<Result<string, ToolError>> => {
  if (path.trim() === '') return invalid(`${name} must not be empty`)
  if (!isAbsolute(path)) return invalid(`${name} must be absolute, got ${path}`)
  const normalized = normalize(path)
  if (expected === 'audio-file' && !isAudioFileName(basename(normalized))) {
    return invalid(
      `${name} must be an audio file (${AUDIO_EXTENSIONS.join(', ')}), got ${normalized}`,
    )
  }
  const kind = await statOf(normalized)
  if (kind === 'missing') return invalid(`${name} does not exist: ${normalized}`)
  const wanted: PathKind = expected === 'directory' ? 'directory' : 'file'
  if (kind !== wanted) {
    return invalid(
      `${name} must be ${expected === 'directory' ? 'a folder' : 'an audio file'}, but ${normalized} is ${kindLabel(kind)}`,
    )
  }
  return ok(normalized)
}
