import { describe, expect, it } from 'vitest'
import { isStrictCompatible } from '../../src/llm/openai-responses.js'
import {
  booleanParam,
  enumParam,
  numberParam,
  optional,
  parseParams,
  stringParam,
  toInputSchema,
} from '../../src/tools/params.js'

const params = {
  track: stringParam('Track name'),
  db: numberParam('Level in dB', { minimum: -96, maximum: 12 }),
  solo: optional(booleanParam('Solo the track')),
  mode: enumParam('Automation mode', ['read', 'touch', 'latch']),
}

describe('toInputSchema', () => {
  it('builds a strict JSON schema object with required and optional properties', () => {
    expect(toInputSchema(params)).toEqual({
      type: 'object',
      properties: {
        track: { type: 'string', description: 'Track name' },
        db: { type: 'number', description: 'Level in dB', minimum: -96, maximum: 12 },
        solo: { type: 'boolean', description: 'Solo the track' },
        mode: { type: 'string', description: 'Automation mode', enum: ['read', 'touch', 'latch'] },
      },
      required: ['track', 'db', 'mode'],
      additionalProperties: false,
    })
  })

  it('is strict-compatible for the Responses API only when every property is required', () => {
    expect(isStrictCompatible(toInputSchema({ path: stringParam('p') }))).toBe(true)
    expect(isStrictCompatible(toInputSchema(params))).toBe(false)
  })
})

describe('parseParams', () => {
  it('returns typed values', () => {
    const parsed = parseParams(params, { track: 'Vox', db: -6, mode: 'touch', solo: true })
    expect(parsed).toEqual({ ok: true, value: { track: 'Vox', db: -6, mode: 'touch', solo: true } })
  })

  it('treats null as a missing optional value', () => {
    const parsed = parseParams(params, { track: 'Vox', db: 0, mode: 'read', solo: null })
    expect(parsed).toEqual({ ok: true, value: { track: 'Vox', db: 0, mode: 'read' } })
  })

  it.each([
    [{ db: 0, mode: 'read' }, 'track is required'],
    [{ track: 1, db: 0, mode: 'read' }, 'track must be a string'],
    [{ track: 'Vox', db: 20, mode: 'read' }, 'db must be at most 12'],
    [{ track: 'Vox', db: -100, mode: 'read' }, 'db must be at least -96'],
    [{ track: 'Vox', db: 'loud', mode: 'read' }, 'db must be a number'],
    [{ track: 'Vox', db: 0, mode: 'write' }, 'mode must be one of read, touch, latch'],
    [{ track: 'Vox', db: 0, mode: 'read', pan: 3 }, 'Unknown parameter: pan'],
  ])('rejects %j with "%s"', (input, message) => {
    expect(parseParams(params, input)).toEqual({ ok: false, error: message })
  })

  it('rejects non-object input', () => {
    expect(parseParams(params, ['Vox'])).toEqual({
      ok: false,
      error: 'Input must be a JSON object',
    })
  })
})
