import { err, ok, type Result } from './result.js'
import type { PlistError, PlistValue } from './types.js'

const HEADER_LENGTH = 8
const TRAILER_LENGTH = 32
const MAX_DEPTH = 256
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1)

type Failure = { readonly binaryPlistFailure: string }

const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && 'binaryPlistFailure' in value

const fail = (message: string): never => {
  throw { binaryPlistFailure: message }
}

type Trailer = {
  readonly offsetIntSize: number
  readonly objectRefSize: number
  readonly objectCount: number
  readonly topObject: number
  readonly offsetTableOffset: number
}

const readUnsigned = (bytes: Uint8Array, offset: number, size: number): number => {
  if (size < 1 || size > 8) fail(`unsupported integer width ${size}`)
  if (offset < 0 || offset + size > bytes.length) fail(`read past end at offset ${offset}`)
  const value = bytes
    .subarray(offset, offset + size)
    .reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`integer too large at offset ${offset}`)
  return Number(value)
}

const readTrailer = (bytes: Uint8Array): Trailer => {
  if (bytes.length < HEADER_LENGTH + TRAILER_LENGTH) fail('file too short')
  const start = bytes.length - TRAILER_LENGTH
  const trailer: Trailer = {
    offsetIntSize: readUnsigned(bytes, start + 6, 1),
    objectRefSize: readUnsigned(bytes, start + 7, 1),
    objectCount: readUnsigned(bytes, start + 8, 8),
    topObject: readUnsigned(bytes, start + 16, 8),
    offsetTableOffset: readUnsigned(bytes, start + 24, 8),
  }
  if (trailer.offsetIntSize < 1 || trailer.offsetIntSize > 8) fail('invalid offset size')
  if (trailer.objectRefSize < 1 || trailer.objectRefSize > 8) fail('invalid reference size')
  if (trailer.objectCount < 1) fail('no objects')
  if (trailer.topObject >= trailer.objectCount) fail('top object out of range')
  if (
    trailer.offsetTableOffset < HEADER_LENGTH ||
    trailer.offsetTableOffset + trailer.objectCount * trailer.offsetIntSize > start
  ) {
    fail('offset table out of range')
  }
  return trailer
}

const decodeUtf16Be = (bytes: Uint8Array): string => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const units = Array.from({ length: bytes.length / 2 }, (_, i) => view.getUint16(i * 2, false))
  const chunks = Array.from({ length: Math.ceil(units.length / 4096) }, (_, i) =>
    String.fromCharCode(...units.slice(i * 4096, (i + 1) * 4096)),
  )
  return chunks.join('')
}

const decodeAscii = (bytes: Uint8Array): string => {
  if (bytes.some((b) => b > 0x7f)) fail('non-ASCII byte in ASCII string')
  return new TextDecoder('latin1').decode(bytes)
}

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return fail('invalid UTF-8 string')
  }
}

const parseDocument = (bytes: Uint8Array): PlistValue => {
  const trailer = readTrailer(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const objectsEnd = trailer.offsetTableOffset
  const cache = new Map<number, PlistValue>()

  const slice = (offset: number, length: number): Uint8Array => {
    if (offset + length > objectsEnd) fail(`object at offset ${offset} runs past object area`)
    return bytes.subarray(offset, offset + length)
  }

  const objectOffset = (ref: number): number => {
    if (ref >= trailer.objectCount) fail(`object reference ${ref} out of range`)
    const offset = readUnsigned(
      bytes,
      trailer.offsetTableOffset + ref * trailer.offsetIntSize,
      trailer.offsetIntSize,
    )
    if (offset < HEADER_LENGTH || offset >= objectsEnd) fail(`object ${ref} offset out of range`)
    return offset
  }

  const readInteger = (offset: number, sizeExponent: number): number => {
    if (sizeExponent > 4) fail(`unsupported integer width at offset ${offset}`)
    const size = 1 << sizeExponent
    slice(offset, size)
    if (size < 8) return readUnsigned(bytes, offset, size)
    if (size === 16 && view.getBigUint64(offset, false) !== 0n) {
      fail(`integer too large at offset ${offset}`)
    }
    const big =
      size === 8 ? view.getBigInt64(offset, false) : view.getBigUint64(offset + size - 8, false)
    if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
      fail(`integer too large at offset ${offset}`)
    }
    return Number(big)
  }

  const readLength = (offset: number, info: number): { length: number; next: number } => {
    if (info !== 0x0f) return { length: info, next: offset + 1 }
    const marker = slice(offset + 1, 1)[0] ?? 0
    if (marker >> 4 !== 0x1) fail(`invalid length marker at offset ${offset + 1}`)
    const exponent = marker & 0x0f
    const length = readInteger(offset + 2, exponent)
    if (length < 0) fail(`negative length at offset ${offset}`)
    return { length, next: offset + 2 + (1 << exponent) }
  }

  const readRefs = (offset: number, count: number): readonly number[] => {
    slice(offset, count * trailer.objectRefSize)
    return Array.from({ length: count }, (_, i) =>
      readUnsigned(bytes, offset + i * trailer.objectRefSize, trailer.objectRefSize),
    )
  }

  const parseObject = (ref: number, path: ReadonlySet<number>): PlistValue => {
    const cached = cache.get(ref)
    if (cached !== undefined) return cached
    if (path.has(ref)) fail(`reference cycle through object ${ref}`)
    if (path.size > MAX_DEPTH) fail('nesting too deep')
    const value = parseAt(ref, new Set([...path, ref]))
    cache.set(ref, value)
    return value
  }

  const parseAt = (ref: number, path: ReadonlySet<number>): PlistValue => {
    const offset = objectOffset(ref)
    const marker = slice(offset, 1)[0] ?? 0
    const type = marker >> 4
    const info = marker & 0x0f
    switch (type) {
      case 0x0:
        if (info === 0x8 || info === 0x9) return { kind: 'boolean', value: info === 0x9 }
        return fail(`unsupported marker 0x${marker.toString(16)} at offset ${offset}`)
      case 0x1:
        return { kind: 'integer', value: readInteger(offset + 1, info) }
      case 0x2:
        if (info === 2) slice(offset + 1, 4)
        else if (info === 3) slice(offset + 1, 8)
        else fail(`unsupported real width at offset ${offset}`)
        return {
          kind: 'real',
          value:
            info === 2 ? view.getFloat32(offset + 1, false) : view.getFloat64(offset + 1, false),
        }
      case 0x3: {
        if (info !== 3) fail(`invalid date marker at offset ${offset}`)
        slice(offset + 1, 8)
        const date = new Date(APPLE_EPOCH_MS + view.getFloat64(offset + 1, false) * 1000)
        if (Number.isNaN(date.getTime())) fail(`invalid date at offset ${offset}`)
        return { kind: 'date', value: date.toISOString().replace('.000Z', 'Z') }
      }
      case 0x4: {
        const { length, next } = readLength(offset, info)
        return { kind: 'data', value: new Uint8Array(slice(next, length)) }
      }
      case 0x5: {
        const { length, next } = readLength(offset, info)
        return { kind: 'string', value: decodeAscii(slice(next, length)) }
      }
      case 0x6: {
        const { length, next } = readLength(offset, info)
        return { kind: 'string', value: decodeUtf16Be(slice(next, length * 2)) }
      }
      case 0x7: {
        const { length, next } = readLength(offset, info)
        return { kind: 'string', value: decodeUtf8(slice(next, length)) }
      }
      case 0x8:
        return { kind: 'uid', value: readUnsigned(bytes, offset + 1, info + 1) }
      case 0xa:
      case 0xc: {
        const { length, next } = readLength(offset, info)
        const items = readRefs(next, length).map((item) => parseObject(item, path))
        return { kind: 'array', value: items }
      }
      case 0xd: {
        const { length, next } = readLength(offset, info)
        const keyRefs = readRefs(next, length)
        const valueRefs = readRefs(next + length * trailer.objectRefSize, length)
        const entries = keyRefs.map((keyRef, i): readonly [string, PlistValue] => {
          const key = parseObject(keyRef, path)
          if (key.kind !== 'string') return fail(`non-string dictionary key at offset ${offset}`)
          return [key.value, parseObject(valueRefs[i] ?? 0, path)]
        })
        return { kind: 'dict', value: new Map(entries) }
      }
      default:
        return fail(`unsupported marker 0x${marker.toString(16)} at offset ${offset}`)
    }
  }

  return parseObject(trailer.topObject, new Set())
}

export const parseBinaryPlist = (bytes: Uint8Array): Result<PlistValue, PlistError> => {
  try {
    return ok(parseDocument(bytes))
  } catch (error) {
    const message = isFailure(error)
      ? error.binaryPlistFailure
      : error instanceof Error
        ? error.message
        : 'unknown error'
    return err({ kind: 'malformed', format: 'binary', message })
  }
}
