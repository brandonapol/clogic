import { err, ok, type Result } from './result.js'
import type { PlistError, PlistValue } from './types.js'

const MAX_DEPTH = 256

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

type Failure = { readonly xmlPlistFailure: string }

const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && 'xmlPlistFailure' in value

const decodeEntities = (raw: string): string =>
  raw.replace(/&([^;&\s]*);?/g, (match, name: string) => {
    if (!match.endsWith(';')) throw { xmlPlistFailure: `unterminated entity "${match}"` }
    const code = /^#x[0-9a-f]+$/i.test(name)
      ? Number.parseInt(name.slice(2), 16)
      : /^#[0-9]+$/.test(name)
        ? Number.parseInt(name.slice(1), 10)
        : undefined
    if (code !== undefined) {
      if (code > 0x10ffff) throw { xmlPlistFailure: `invalid character reference "${match}"` }
      return String.fromCodePoint(code)
    }
    const named = NAMED_ENTITIES[name]
    if (named === undefined) throw { xmlPlistFailure: `unknown entity "${match}"` }
    return named
  })

const parseInteger = (text: string): number => {
  const trimmed = text.trim()
  const value = /^[+-]?0x[0-9a-f]+$/i.test(trimmed)
    ? (trimmed.startsWith('-') ? -1 : 1) * Number.parseInt(trimmed.replace(/^[+-]?0x/i, ''), 16)
    : /^[+-]?[0-9]+$/.test(trimmed)
      ? Number.parseInt(trimmed, 10)
      : Number.NaN
  if (Number.isNaN(value)) throw { xmlPlistFailure: `invalid integer "${trimmed}"` }
  return value
}

const parseReal = (text: string): number => {
  const trimmed = text.trim().toLowerCase()
  if (trimmed === 'nan') return Number.NaN
  if (/^[+-]?inf(inity)?$/.test(trimmed)) return trimmed.startsWith('-') ? -Infinity : Infinity
  if (!/^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)(e[+-]?[0-9]+)?$/.test(trimmed)) {
    throw { xmlPlistFailure: `invalid real "${trimmed}"` }
  }
  return Number.parseFloat(trimmed)
}

const parseDate = (text: string): string => {
  const trimmed = text.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(trimmed)) {
    throw { xmlPlistFailure: `invalid date "${trimmed}"` }
  }
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) throw { xmlPlistFailure: `invalid date "${trimmed}"` }
  return date.toISOString().replace('.000Z', 'Z')
}

const parseData = (text: string): Uint8Array => {
  const compact = text.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw { xmlPlistFailure: 'invalid base64 data' }
  }
  return new Uint8Array(Buffer.from(compact, 'base64'))
}

const decodeText = (bytes: Uint8Array): string => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return text.startsWith('﻿') ? text.slice(1) : text
}

type Tag = { readonly name: string; readonly selfClosing: boolean }

const parseDocument = (text: string): PlistValue => {
  let pos = 0

  const fail = (message: string): never => {
    throw { xmlPlistFailure: `${message} at offset ${pos}` }
  }

  const skipUntil = (terminator: string): void => {
    const end = text.indexOf(terminator, pos)
    if (end < 0) fail(`missing "${terminator}"`)
    pos = end + terminator.length
  }

  const skipDoctype = (): void => {
    const close = text.indexOf('>', pos)
    const subset = text.indexOf('[', pos)
    if (subset >= 0 && (close < 0 || subset < close)) skipUntil(']')
    skipUntil('>')
  }

  const skipMisc = (): void => {
    for (;;) {
      const rest = text.slice(pos, pos + 9)
      if (/^\s/.test(rest)) pos += 1
      else if (rest.startsWith('<?')) skipUntil('?>')
      else if (rest.startsWith('<!--')) skipUntil('-->')
      else if (rest.startsWith('<!DOCTYPE')) skipDoctype()
      else return
    }
  }

  const readTag = (): Tag => {
    const match = /^<([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(
      text.slice(pos, pos + 1024),
    )
    if (match === null) return fail('expected an element')
    pos += match[0].length
    return { name: match[1] ?? '', selfClosing: match[3] === '/' }
  }

  const readEndTag = (name: string): void => {
    const match = /^<\/([A-Za-z_][\w.-]*)\s*>/.exec(text.slice(pos, pos + 256))
    if (match === null || match[1] !== name) fail(`expected </${name}>`)
    pos += match?.[0].length ?? 0
  }

  const readText = (name: string): string => {
    let collected = ''
    for (;;) {
      const next = text.indexOf('<', pos)
      if (next < 0) return fail(`unclosed <${name}>`)
      collected += decodeEntities(text.slice(pos, next))
      pos = next
      if (text.startsWith('<![CDATA[', pos)) {
        const end = text.indexOf(']]>', pos)
        if (end < 0) fail('unclosed CDATA section')
        collected += text.slice(pos + 9, end)
        pos = end + 3
      } else if (text.startsWith('<!--', pos)) {
        skipUntil('-->')
      } else {
        readEndTag(name)
        return collected
      }
    }
  }

  const textContent = (tag: Tag): string => (tag.selfClosing ? '' : readText(tag.name))

  const atEndTag = (): boolean => {
    skipMisc()
    return text.startsWith('</', pos)
  }

  const parseValue = (depth: number): PlistValue => {
    if (depth > MAX_DEPTH) fail('nesting too deep')
    skipMisc()
    const tag = readTag()
    switch (tag.name) {
      case 'string':
        return { kind: 'string', value: textContent(tag) }
      case 'integer':
        return { kind: 'integer', value: parseInteger(textContent(tag)) }
      case 'real':
        return { kind: 'real', value: parseReal(textContent(tag)) }
      case 'date':
        return { kind: 'date', value: parseDate(textContent(tag)) }
      case 'data':
        return { kind: 'data', value: parseData(textContent(tag)) }
      case 'true':
      case 'false':
        if (textContent(tag).trim() !== '') fail(`<${tag.name}> must be empty`)
        return { kind: 'boolean', value: tag.name === 'true' }
      case 'array': {
        const items: PlistValue[] = []
        if (!tag.selfClosing) {
          while (!atEndTag()) items.push(parseValue(depth + 1))
          readEndTag('array')
        }
        return { kind: 'array', value: items }
      }
      case 'dict': {
        const entries = new Map<string, PlistValue>()
        if (!tag.selfClosing) {
          while (!atEndTag()) {
            const keyTag = readTag()
            if (keyTag.name !== 'key') fail('expected <key> in <dict>')
            const key = textContent(keyTag)
            if (atEndTag()) fail(`missing value for key "${key}"`)
            entries.set(key, parseValue(depth + 1))
          }
          readEndTag('dict')
        }
        return { kind: 'dict', value: entries }
      }
      default:
        return fail(`unexpected element <${tag.name}>`)
    }
  }

  const parseRoot = (): PlistValue => {
    skipMisc()
    if (!/^<plist[\s/>]/.test(text.slice(pos, pos + 7))) return parseValue(0)
    const plist = readTag()
    if (plist.selfClosing) return fail('empty <plist>')
    const value = parseValue(0)
    skipMisc()
    readEndTag('plist')
    return value
  }

  const root = parseRoot()
  skipMisc()
  if (pos !== text.length) fail('unexpected content after root element')
  return root
}

export const parseXmlPlist = (bytes: Uint8Array): Result<PlistValue, PlistError> => {
  try {
    return ok(parseDocument(decodeText(bytes)))
  } catch (error) {
    const message = isFailure(error)
      ? error.xmlPlistFailure
      : error instanceof Error
        ? error.message
        : 'unknown error'
    return err({ kind: 'malformed', format: 'xml', message })
  }
}
