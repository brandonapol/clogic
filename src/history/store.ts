import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { err, ok, type Result } from '../llm/result.js'
import { decodeConversation, encodeConversation } from './codec.js'
import { summarize } from './record.js'
import type { ConversationRecord, ConversationSummary, DecodeError } from './types.js'

export type HistoryError =
  | { readonly kind: 'invalid_id'; readonly id: string }
  | { readonly kind: 'invalid_base_dir'; readonly baseDir: string }
  | { readonly kind: 'corrupt'; readonly id: string; readonly error: DecodeError }
  | { readonly kind: 'io'; readonly message: string }

export type HistoryListing = {
  readonly conversations: readonly ConversationSummary[]
  readonly corrupt: readonly { readonly id: string; readonly error: DecodeError }[]
}

export type HistoryStoreOptions = {
  readonly baseDir: string
  readonly secrets?: () => readonly string[]
}

export type HistoryStore = {
  readonly save: (record: ConversationRecord) => Promise<Result<void, HistoryError>>
  readonly load: (id: string) => Promise<Result<ConversationRecord | null, HistoryError>>
  readonly list: () => Promise<Result<HistoryListing, HistoryError>>
  readonly remove: (id: string) => Promise<Result<boolean, HistoryError>>
}

const fileMode = 0o600
const dirMode = 0o700
const extension = '.json'
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const logicBundlePattern = /\.(?:logicx|band)$/i

export const isValidConversationId = (id: string): boolean => idPattern.test(id)

const isInsideLogicBundle = (dir: string): boolean =>
  resolve(dir)
    .split(sep)
    .some((segment) => logicBundlePattern.test(segment))

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const hasCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === code

const io = (cause: unknown): HistoryError => ({ kind: 'io', message: messageOf(cause) })

const writeAtomic = async (dir: string, target: string, contents: string): Promise<void> => {
  const temp = join(dir, `.${randomUUID()}.tmp`)
  try {
    const handle = await open(temp, 'wx', fileMode)
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temp, fileMode)
    await rename(temp, target)
  } catch (cause) {
    await rm(temp, { force: true })
    throw cause
  }
}

const decodeFile = (id: string, text: string): Result<ConversationRecord, HistoryError> => {
  const decoded = decodeConversation(text)
  if (!decoded.ok) return err({ kind: 'corrupt', id, error: decoded.error })
  if (decoded.value.id !== id)
    return err({
      kind: 'corrupt',
      id,
      error: { kind: 'invalid_record', message: `id: expected ${id}` },
    })
  return decoded
}

export const createHistoryStore = (options: HistoryStoreOptions): HistoryStore => {
  const baseDir = resolve(options.baseDir)
  const secrets = options.secrets ?? (() => [])
  const pathFor = (id: string) => join(baseDir, `${id}${extension}`)
  const checkBase = (): Result<void, HistoryError> =>
    isInsideLogicBundle(baseDir) ? err({ kind: 'invalid_base_dir', baseDir }) : ok(undefined)
  const checkId = (id: string): Result<void, HistoryError> => {
    const base = checkBase()
    if (!base.ok) return base
    return isValidConversationId(id) ? ok(undefined) : err({ kind: 'invalid_id', id })
  }

  const save: HistoryStore['save'] = async (record) => {
    const valid = checkId(record.id)
    if (!valid.ok) return valid
    try {
      await mkdir(baseDir, { recursive: true, mode: dirMode })
      await writeAtomic(baseDir, pathFor(record.id), encodeConversation(record, secrets()))
      return ok(undefined)
    } catch (cause) {
      return err(io(cause))
    }
  }

  const load: HistoryStore['load'] = async (id) => {
    const valid = checkId(id)
    if (!valid.ok) return valid
    try {
      return decodeFile(id, await readFile(pathFor(id), 'utf8'))
    } catch (cause) {
      return hasCode(cause, 'ENOENT') ? ok(null) : err(io(cause))
    }
  }

  const list: HistoryStore['list'] = async () => {
    const base = checkBase()
    if (!base.ok) return base
    const names = await readdir(baseDir).then(
      (entries): Result<readonly string[], HistoryError> => ok(entries),
      (cause: unknown) => (hasCode(cause, 'ENOENT') ? ok([]) : err(io(cause))),
    )
    if (!names.ok) return names
    const ids = names.value
      .filter((name) => name.endsWith(extension))
      .map((name) => name.slice(0, -extension.length))
      .filter(isValidConversationId)
      .sort()
    const loaded = await Promise.all(ids.map(async (id) => ({ id, result: await load(id) })))
    const failure = loaded.find((entry) => !entry.result.ok && entry.result.error.kind === 'io')
    if (failure !== undefined && !failure.result.ok) return failure.result
    return ok({
      conversations: loaded
        .flatMap((entry) =>
          entry.result.ok && entry.result.value !== null ? [entry.result.value] : [],
        )
        .map(summarize)
        .sort((a, b) => b.updatedAt - a.updatedAt),
      corrupt: loaded.flatMap((entry) =>
        !entry.result.ok && entry.result.error.kind === 'corrupt'
          ? [{ id: entry.id, error: entry.result.error.error }]
          : [],
      ),
    })
  }

  const remove: HistoryStore['remove'] = async (id) => {
    const valid = checkId(id)
    if (!valid.ok) return valid
    try {
      await rm(pathFor(id))
      return ok(true)
    } catch (cause) {
      return hasCode(cause, 'ENOENT') ? ok(false) : err(io(cause))
    }
  }

  return { save, load, list, remove }
}
