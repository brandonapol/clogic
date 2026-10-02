import { describe, expect, it } from 'vitest'
import {
  DB_CEILING,
  DB_FLOOR,
  amplitudeToDb,
  dbToAmplitude,
  powerRatioDb,
  powerToDb,
  round,
} from '../../src/analysis/db.js'

describe('dB helpers', () => {
  it('converts amplitude and power', () => {
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 4)
    expect(powerToDb(0.5)).toBeCloseTo(-3.0103, 4)
    expect(dbToAmplitude(-20)).toBeCloseTo(0.1, 12)
  })

  it('clamps silence and infinite ratios to finite, JSON-safe values', () => {
    expect(powerToDb(0)).toBe(DB_FLOOR)
    expect(powerToDb(1e-30)).toBe(DB_FLOOR)
    expect(powerRatioDb(1, 0)).toBe(DB_CEILING)
    expect(powerRatioDb(0, 0)).toBe(DB_FLOOR)
    expect(powerRatioDb(1, 2)).toBeCloseTo(-3.0103, 4)
  })

  it('rounds without producing negative zero', () => {
    expect(round(-0.04)).toBe(0)
    expect(Object.is(round(-0.04), -0)).toBe(false)
    expect(round(1.256, 2)).toBe(1.26)
  })
})
