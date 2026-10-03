import { parseBinaryPlist } from './binary-plist.js'
import { err, type Result } from './result.js'
import type { PlistError, PlistValue } from './types.js'
import { parseXmlPlist } from './xml-plist.js'

const BINARY_MAGIC = 'bplist'

const startsWithAscii = (bytes: Uint8Array, prefix: string): boolean =>
  bytes.length >= prefix.length && [...prefix].every((c, i) => bytes[i] === c.charCodeAt(0))

const firstMeaningfulByte = (bytes: Uint8Array): number | undefined => {
  const start = startsWithAscii(bytes, 'ï»¿') ? 3 : 0
  return bytes.slice(start).find((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)
}

export const parsePlist = (bytes: Uint8Array): Result<PlistValue, PlistError> => {
  if (startsWithAscii(bytes, `${BINARY_MAGIC}00`)) return parseBinaryPlist(bytes)
  if (startsWithAscii(bytes, BINARY_MAGIC)) {
    return err({
      kind: 'unsupported-format',
      format: String.fromCharCode(...bytes.slice(0, 8)),
    })
  }
  if (firstMeaningfulByte(bytes) === '<'.charCodeAt(0)) return parseXmlPlist(bytes)
  return err({ kind: 'unsupported-format', format: bytes.length === 0 ? 'empty' : 'unknown' })
}
