import { describe, expect, it } from 'vitest'
import {
  array,
  finiteNumber,
  jsonObject,
  jsonValue,
  literal,
  nonEmptyString,
  nonNegativeInteger,
  nullable,
  object,
  string,
} from '../../src/rpc/decode.js'

describe('primitive decoders', () => {
  it('accepts matching values and reports the path otherwise', () => {
    expect(string('a', 'x')).toEqual({ ok: true, value: 'a' })
    expect(string(1, 'x')).toEqual({ ok: false, error: 'x: expected string, got number' })
    expect(nonEmptyString('', 'x').ok).toBe(false)
    expect(finiteNumber(Number.NaN, 'x').ok).toBe(false)
    expect(finiteNumber(Infinity, 'x').ok).toBe(false)
    expect(nonNegativeInteger(-1, 'x').ok).toBe(false)
    expect(nonNegativeInteger(1.5, 'x').ok).toBe(false)
    expect(nonNegativeInteger(3, 'x')).toEqual({ ok: true, value: 3 })
  })

  it('decodes literals and nullables', () => {
    const color = literal('red', 'green')
    expect(color('green', 'c')).toEqual({ ok: true, value: 'green' })
    expect(color('blue', 'c')).toEqual({ ok: false, error: 'c: expected one of "red", "green"' })
    expect(nullable(string)(null, 'n')).toEqual({ ok: true, value: null })
    expect(nullable(string)(undefined, 'n').ok).toBe(false)
  })
})

describe('array', () => {
  it('reports the index of the first bad item', () => {
    expect(array(finiteNumber)([1, 2], 'a')).toEqual({ ok: true, value: [1, 2] })
    expect(array(finiteNumber)([1, 'two'], 'a')).toEqual({
      ok: false,
      error: 'a[1]: expected finite number, got string',
    })
    expect(array(finiteNumber)({}, 'a').ok).toBe(false)
  })
})

describe('object', () => {
  type Point = { readonly x: number; readonly label: string | null }
  const point = object<Point>({ x: finiteNumber, label: nullable(string) })

  it('keeps only declared fields', () => {
    expect(point({ x: 1, label: null, extra: true }, 'p')).toEqual({
      ok: true,
      value: { x: 1, label: null },
    })
  })

  it('treats missing fields as errors with a nested path', () => {
    expect(point({ x: 1 }, 'p')).toEqual({
      ok: false,
      error: 'p.label: expected string, got undefined',
    })
    expect(point([], 'p')).toEqual({ ok: false, error: 'p: expected object, got array' })
  })

  it('does not let a __proto__ key change the prototype', () => {
    const decoded = jsonObject(JSON.parse('{"__proto__": {"polluted": true}}'), 'o')
    expect(decoded.ok).toBe(true)
    expect(Object.getPrototypeOf(decoded.ok ? decoded.value : null)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('jsonValue', () => {
  it('accepts nested JSON and rejects non-JSON values', () => {
    expect(jsonValue({ a: [1, 'b', null, { c: true }] }, 'v').ok).toBe(true)
    expect(jsonValue(undefined, 'v').ok).toBe(false)
    expect(jsonValue({ a: () => 1 }, 'v').ok).toBe(false)
    expect(jsonValue([Number.NaN], 'v')).toEqual({
      ok: false,
      error: 'v[0]: expected finite number, got number',
    })
  })

  it('rejects absurd nesting', () => {
    const deep = JSON.parse(`${'['.repeat(100)}${']'.repeat(100)}`) as unknown
    expect(jsonValue(deep, 'v').ok).toBe(false)
  })

  it('requires jsonObject to be an object', () => {
    expect(jsonObject([1], 'o').ok).toBe(false)
  })
})
