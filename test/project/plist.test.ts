import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlist } from '../../src/project/plist.js'
import type { PlistValue } from '../../src/project/types.js'
import { real, toBinaryPlist, toXmlPlist, type Plain } from './plists.js'

const PLISTLIB_BINARY = new URL('./fixtures/plistlib-metadata.bplist', import.meta.url)

type Json = string | number | boolean | readonly Json[] | { readonly [key: string]: Json }

const toJson = (value: PlistValue): Json => {
  switch (value.kind) {
    case 'array':
      return value.value.map(toJson)
    case 'dict':
      return Object.fromEntries([...value.value].map(([k, v]) => [k, toJson(v)]))
    case 'data':
      return `data:${Buffer.from(value.value).toString('hex')}`
    case 'date':
      return `date:${value.value}`
    case 'uid':
      return `uid:${value.value}`
    case 'real':
      return `real:${value.value}`
    default:
      return value.value
  }
}

const parseJson = (bytes: Uint8Array): Json => {
  const result = parsePlist(bytes)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return toJson(result.value)
}

const text = (xml: string): Uint8Array => new TextEncoder().encode(xml)

const malformed = (bytes: Uint8Array): string => {
  const result = parsePlist(bytes)
  if (result.ok || result.error.kind !== 'malformed') {
    throw new Error(`expected malformed, got ${JSON.stringify(result)}`)
  }
  return result.error.message
}

const sample: Plain = {
  BeatsPerMinute: real(97.5),
  SampleRate: 48000,
  Negative: -3,
  Flag: true,
  Off: false,
  Name: 'Café <A&B> ✓ 𝄞',
  Blob: new Uint8Array([0, 1, 255]),
  Empty: [],
  Nested: { list: [1, real(2.25), 'x', { deep: [] }] },
}

const sampleJson: Json = {
  BeatsPerMinute: 'real:97.5',
  SampleRate: 48000,
  Negative: -3,
  Flag: true,
  Off: false,
  Name: 'Café <A&B> ✓ 𝄞',
  Blob: 'data:0001ff',
  Empty: [],
  Nested: { list: [1, 'real:2.25', 'x', { deep: [] }] },
}

describe('parsePlist with XML', () => {
  it('reads every plain value type', () => {
    expect(parseJson(toXmlPlist(sample))).toEqual(sampleJson)
  })

  it('handles empty elements, entities, CDATA, comments, dates and reals', () => {
    const xml = `\ufeff<?xml version="1.0"?>
      <!-- leading comment -->
      <!DOCTYPE plist [ <!ELEMENT plist ANY> ]>
      <plist version="1.0"><dict>
        <key>empty</key><string/>
        <key>arr</key><array/>
        <key>dict</key><dict/>
        <key>ent</key><string>&lt;&#65;&#x42;&quot;&apos;&gt;</string>
        <key>cdata</key><string>a<![CDATA[<b>&c]]><!-- skip -->d</string>
        <key>when</key><date>2026-10-02T12:30:00Z</date>
        <key>reals</key><array><real>1e3</real><real>-.5</real><real>inf</real><real>-inf</real></array>
        <key>hex</key><integer>0x1F</integer>
        <key>t</key><true></true>
        <key>data</key><data>
          AAH/
        </data>
      </dict></plist>`
    expect(parseJson(text(xml))).toEqual({
      empty: '',
      arr: [],
      dict: {},
      ent: '<AB"\'>',
      cdata: 'a<b>&cd',
      when: 'date:2026-10-02T12:30:00Z',
      reals: ['real:1000', 'real:-0.5', 'real:Infinity', 'real:-Infinity'],
      hex: 31,
      t: true,
      data: 'data:0001ff',
    })
  })

  it('accepts a bare root value without a plist element', () => {
    expect(parseJson(text('<array><integer>1</integer></array>'))).toEqual([1])
  })

  it('keeps a __proto__ key as ordinary data', () => {
    const result = parsePlist(text('<dict><key>__proto__</key><string>x</string></dict>'))
    expect(
      result.ok && result.value.kind === 'dict' && result.value.value.get('__proto__'),
    ).toEqual({ kind: 'string', value: 'x' })
  })

  it.each([
    ['unclosed dict', '<plist><dict><key>a</key><string>b</string></plist>'],
    ['mismatched end tag', '<plist><string>a</integer></plist>'],
    ['missing dict value', '<plist><dict><key>a</key></dict></plist>'],
    ['value without key', '<plist><dict><string>a</string></dict></plist>'],
    ['bad integer', '<plist><integer>1.5</integer></plist>'],
    ['bad real', '<plist><real>fast</real></plist>'],
    ['bad date', '<plist><date>yesterday</date></plist>'],
    ['bad base64', '<plist><data>!!!</data></plist>'],
    ['unknown entity', '<plist><string>&nbsp;</string></plist>'],
    ['unterminated entity', '<plist><string>a &amp b</string></plist>'],
    ['unknown element', '<plist><float>1</float></plist>'],
    ['trailing content', '<plist><true/></plist><true/>'],
    ['non-empty true', '<plist><true>yes</true></plist>'],
    ['empty plist', '<plist/>'],
    ['truncated', '<plist><array><string>a'],
  ])('reports %s as malformed', (_, xml) => {
    expect(malformed(text(xml))).not.toBe('')
  })

  it('rejects invalid UTF-8', () => {
    expect(malformed(new Uint8Array([0x3c, 0x73, 0xff, 0x3e]))).not.toBe('')
  })

  it('rejects absurd nesting without overflowing the stack', () => {
    expect(malformed(text('<plist>' + '<array>'.repeat(10000)))).toMatch(/too deep/)
  })
})

describe('parsePlist with binary plists', () => {
  it('reads a plist written by Python plistlib', () => {
    expect(parseJson(new Uint8Array(readFileSync(PLISTLIB_BINARY)))).toEqual({
      AudioFiles: [],
      BeatsPerMinute: 'real:120',
      Big: -5,
      Blob: 'data:0001ff',
      HasARAPlugins: false,
      Name: 'Café ✓',
      Nested: { a: [1, 'real:2.5', true] },
      NumberOfTracks: 24,
      SampleRate: 44100,
      SamplerInstrumentsFiles: [
        '/Library/Application Support/Logic/Sampler Instruments/Steinway.exs',
      ],
      SongGenderKey: 'major',
      SongKey: 'C',
      SongSignatureDenominator: 4,
      SongSignatureNumerator: 4,
      Uid: 'uid:7',
      Version: 3,
      When: 'date:2026-10-02T12:30:00Z',
      Wide: 70000,
      isTimeCodeBased: false,
    })
  })

  it('reads every plain value type from the test encoder', () => {
    expect(parseJson(toBinaryPlist(sample))).toEqual(sampleJson)
  })

  it('reads long strings and arrays with extended length markers', () => {
    const long = 'x'.repeat(300)
    const items = Array.from({ length: 20 }, (_, i) => i)
    expect(parseJson(toBinaryPlist({ long, items }))).toEqual({ long, items })
  })

  it('resolves an object referenced several times', () => {
    const bytes = new Uint8Array([
      ...[...'bplist00'].map((c) => c.charCodeAt(0)),
      0xa3,
      0x01,
      0x01,
      0x01,
      0x51,
      0x61,
      0x08,
      0x0c,
      ...[0, 0, 0, 0, 0, 0, 1, 1],
      ...[0, 0, 0, 0, 0, 0, 0, 2],
      ...[0, 0, 0, 0, 0, 0, 0, 0],
      ...[0, 0, 0, 0, 0, 0, 0, 14],
    ])
    expect(parseJson(bytes)).toEqual(['a', 'a', 'a'])
  })

  const valid = (): Uint8Array => toBinaryPlist({ a: [1, 2], b: 'text' })

  const withTrailer = (patch: (view: DataView, trailerStart: number) => void): Uint8Array => {
    const bytes = valid()
    patch(new DataView(bytes.buffer), bytes.length - 32)
    return bytes
  }

  it('rejects a truncated file', () => {
    expect(malformed(valid().slice(0, 20))).toMatch(/too short/)
  })

  it('rejects a top object outside the object table', () => {
    expect(malformed(withTrailer((v, t) => v.setBigUint64(t + 16, 999n)))).toMatch(/top object/)
  })

  it('rejects an offset table outside the file', () => {
    expect(malformed(withTrailer((v, t) => v.setBigUint64(t + 24, 1n << 40n)))).toMatch(
      /offset table/,
    )
  })

  it('rejects an invalid reference size', () => {
    expect(malformed(withTrailer((v, t) => v.setUint8(t + 7, 0)))).toMatch(/reference size/)
  })

  it('rejects a reference cycle', () => {
    const bytes = new Uint8Array([
      ...[...'bplist00'].map((c) => c.charCodeAt(0)),
      0xa1,
      0x00,
      0x08,
      ...[0, 0, 0, 0, 0, 0, 1, 1],
      ...[0, 0, 0, 0, 0, 0, 0, 1],
      ...[0, 0, 0, 0, 0, 0, 0, 0],
      ...[0, 0, 0, 0, 0, 0, 0, 10],
    ])
    expect(malformed(bytes)).toMatch(/cycle/)
  })

  it('rejects a non-string dictionary key', () => {
    const bytes = new Uint8Array([
      ...[...'bplist00'].map((c) => c.charCodeAt(0)),
      0xd1,
      0x01,
      0x01,
      0x10,
      0x05,
      0x08,
      0x0b,
      ...[0, 0, 0, 0, 0, 0, 1, 1],
      ...[0, 0, 0, 0, 0, 0, 0, 2],
      ...[0, 0, 0, 0, 0, 0, 0, 0],
      ...[0, 0, 0, 0, 0, 0, 0, 13],
    ])
    expect(malformed(bytes)).toMatch(/non-string dictionary key/)
  })

  it('rejects an object running past the object area', () => {
    const bytes = new Uint8Array([
      ...[...'bplist00'].map((c) => c.charCodeAt(0)),
      0x5e,
      0x41,
      0x08,
      ...[0, 0, 0, 0, 0, 0, 1, 1],
      ...[0, 0, 0, 0, 0, 0, 0, 1],
      ...[0, 0, 0, 0, 0, 0, 0, 0],
      ...[0, 0, 0, 0, 0, 0, 0, 10],
    ])
    expect(malformed(bytes)).toMatch(/runs past/)
  })
})

describe('parsePlist format detection', () => {
  it('reports unsupported binary plist versions', () => {
    expect(parsePlist(text('bplist15xxxxxxxx'))).toEqual({
      ok: false,
      error: { kind: 'unsupported-format', format: 'bplist15' },
    })
  })

  it('reports OpenStep and empty input as unsupported', () => {
    expect(parsePlist(text('{ a = b; }'))).toEqual({
      ok: false,
      error: { kind: 'unsupported-format', format: 'unknown' },
    })
    expect(parsePlist(new Uint8Array())).toEqual({
      ok: false,
      error: { kind: 'unsupported-format', format: 'empty' },
    })
  })
})
