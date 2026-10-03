import { constants } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseMetaData, parseProjectInformation } from './metadata.js'
import { err, ok, type Result } from './result.js'
import type {
  AlternativeMetadata,
  LogicProjectMetadata,
  MetadataError,
  PlistFile,
  ProjectReadError,
} from './types.js'

export const MAX_PLIST_BYTES = 8 * 1024 * 1024

const ALTERNATIVE_ID = /^\d{3}$/

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type FileRead =
  | { readonly status: 'read'; readonly bytes: Uint8Array }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable'; readonly message: string }
  | { readonly status: 'too-large'; readonly bytes: number }

const readFileReadOnly = async (path: string): Promise<FileRead> => {
  try {
    const handle = await open(path, constants.O_RDONLY)
    try {
      const info = await handle.stat()
      if (!info.isFile()) return { status: 'unreadable', message: 'not a regular file' }
      if (info.size > MAX_PLIST_BYTES) return { status: 'too-large', bytes: info.size }
      return { status: 'read', bytes: new Uint8Array(await handle.readFile()) }
    } finally {
      await handle.close()
    }
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? { status: 'missing' }
      : { status: 'unreadable', message: errorMessage(error) }
  }
}

const readPlistFile = async <T>(
  path: string,
  parse: (bytes: Uint8Array) => Result<T, MetadataError>,
): Promise<PlistFile<T>> => {
  const file = await readFileReadOnly(path)
  if (file.status !== 'read') return file
  const parsed = parse(file.bytes)
  return parsed.ok
    ? { status: 'read', value: parsed.value }
    : { status: 'invalid', error: parsed.error }
}

const listAlternativeIds = async (
  bundle: string,
): Promise<Result<readonly string[] | undefined, ProjectReadError>> => {
  const path = join(bundle, 'Alternatives')
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return ok(
      entries
        .filter((entry) => entry.isDirectory() && ALTERNATIVE_ID.test(entry.name))
        .map((entry) => entry.name)
        .sort(),
    )
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return ok(undefined)
    return err({ kind: 'read-failed', path, message: errorMessage(error) })
  }
}

export const readLogicProjectMetadata = async (
  bundle: string,
): Promise<Result<LogicProjectMetadata, ProjectReadError>> => {
  try {
    if (!(await stat(bundle)).isDirectory()) return err({ kind: 'not-a-bundle', path: bundle })
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? err({ kind: 'not-found', path: bundle })
      : err({ kind: 'read-failed', path: bundle, message: errorMessage(error) })
  }

  const ids = await listAlternativeIds(bundle)
  if (!ids.ok) return ids
  const projectInformation = await readPlistFile(
    join(bundle, 'Resources', 'ProjectInformation.plist'),
    parseProjectInformation,
  )
  if (ids.value === undefined && projectInformation.status === 'missing') {
    return err({ kind: 'not-a-bundle', path: bundle })
  }

  const alternatives = await Promise.all(
    (ids.value ?? []).map(async (id): Promise<AlternativeMetadata> => ({
      id,
      metadata: await readPlistFile(
        join(bundle, 'Alternatives', id, 'MetaData.plist'),
        parseMetaData,
      ),
    })),
  )
  return ok({ projectInformation, alternatives })
}
