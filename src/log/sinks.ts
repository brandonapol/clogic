import { appendFileSync, chmodSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { err, ok, type Result } from '../llm/result.js'
import { formatLine } from './format.js'
import type { LogRecord, Sink } from './types.js'

export type StderrSinkOptions = {
  readonly write?: (line: string) => void
  readonly includeContent?: boolean
}

export const createStderrSink = (options: StderrSinkOptions = {}): Sink => {
  const write = options.write ?? ((line: string) => void process.stderr.write(line))
  const includeContent = options.includeContent === true
  return (record) => write(formatLine(record, { includeContent }))
}

export type FileSinkOptions = {
  readonly dir: string
  readonly fileName?: string
  readonly maxBytes?: number
  readonly maxFiles?: number
  readonly includeContent?: boolean
  readonly onError?: (message: string) => void
}

export type FileSinkError =
  | { readonly kind: 'invalid_dir'; readonly dir: string }
  | { readonly kind: 'invalid_file_name'; readonly fileName: string }
  | { readonly kind: 'invalid_limits'; readonly message: string }

export const defaultLogFileName = 'clogic.log'
export const defaultMaxBytes = 1024 * 1024
export const defaultMaxFiles = 3

const fileMode = 0o600
const dirMode = 0o700
const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const logicBundlePattern = /\.(?:logicx|band)$/i

const isInsideLogicBundle = (dir: string): boolean =>
  dir.split(sep).some((segment) => logicBundlePattern.test(segment))

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const sizeOf = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export const rotatedName = (fileName: string, index: number): string =>
  index === 0 ? fileName : `${fileName}.${index}`

const rotate = (dir: string, fileName: string, maxFiles: number): void => {
  const pathAt = (index: number) => join(dir, rotatedName(fileName, index))
  rmSync(pathAt(maxFiles - 1), { force: true })
  Array.from({ length: maxFiles - 1 }, (_, offset) => maxFiles - 2 - offset).forEach((index) => {
    try {
      renameSync(pathAt(index), pathAt(index + 1))
    } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
    }
  })
}

export const createFileSink = (options: FileSinkOptions): Result<Sink, FileSinkError> => {
  const fileName = options.fileName ?? defaultLogFileName
  const maxBytes = options.maxBytes ?? defaultMaxBytes
  const maxFiles = options.maxFiles ?? defaultMaxFiles
  if (!isAbsolute(options.dir) || isInsideLogicBundle(resolve(options.dir)))
    return err({ kind: 'invalid_dir', dir: options.dir })
  if (!fileNamePattern.test(fileName)) return err({ kind: 'invalid_file_name', fileName })
  if (!Number.isInteger(maxBytes) || maxBytes < 1)
    return err({ kind: 'invalid_limits', message: 'maxBytes must be a positive integer' })
  if (!Number.isInteger(maxFiles) || maxFiles < 1)
    return err({ kind: 'invalid_limits', message: 'maxFiles must be a positive integer' })

  const dir = resolve(options.dir)
  const path = join(dir, fileName)
  const includeContent = options.includeContent === true
  const onError = options.onError ?? (() => undefined)

  const write = (record: LogRecord): void => {
    const line = formatLine(record, { includeContent })
    mkdirSync(dir, { recursive: true, mode: dirMode })
    const size = sizeOf(path)
    if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
      if (maxFiles > 1) rotate(dir, fileName, maxFiles)
      else rmSync(path, { force: true })
    }
    appendFileSync(path, line, { mode: fileMode })
    chmodSync(path, fileMode)
  }

  return ok((record) => {
    try {
      write(record)
    } catch (cause) {
      onError(messageOf(cause))
    }
  })
}
