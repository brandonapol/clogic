import { describe, expect, it } from 'vitest'
import { dbToPosition, faderCalibration, positionToDb } from '../../src/mcu/index.js'
import type { FaderCalibration } from '../../src/mcu/index.js'

const calibration = (): FaderCalibration => {
  const result = faderCalibration([
    { position: 0, db: -Infinity },
    { position: 1000, db: -60 },
    { position: 12000, db: 0 },
    { position: 16383, db: 6 },
  ])
  if (!result.ok) throw new Error(result.error.kind)
  return result.value
}

describe('faderCalibration', () => {
  it('rejects fewer than two points', () => {
    expect(faderCalibration([{ position: 0, db: 0 }])).toEqual({
      ok: false,
      error: { kind: 'too-few-points', count: 1 },
    })
  })

  it('rejects positions outside 14 bits and NaN levels', () => {
    expect(
      faderCalibration([
        { position: 0, db: 0 },
        { position: 20000, db: 6 },
      ]).ok,
    ).toBe(false)
    expect(
      faderCalibration([
        { position: 0, db: NaN },
        { position: 10, db: 6 },
      ]).ok,
    ).toBe(false)
  })

  it('rejects curves whose level does not rise with position', () => {
    const result = faderCalibration([
      { position: 0, db: -10 },
      { position: 100, db: -20 },
    ])
    expect(result.ok || result.error.kind).toBe('not-monotonic')
  })

  it('sorts points by position', () => {
    const result = faderCalibration([
      { position: 100, db: 0 },
      { position: 0, db: -10 },
    ])
    expect(result.ok && result.value.points.map((point) => point.position)).toEqual([0, 100])
  })
})

describe('dbToPosition and positionToDb', () => {
  it('returns measured points exactly, including minus infinity', () => {
    expect(dbToPosition(calibration(), 0)).toEqual({ ok: true, value: 12000 })
    expect(dbToPosition(calibration(), -Infinity)).toEqual({ ok: true, value: 0 })
    expect(positionToDb(calibration(), 16383)).toEqual({ ok: true, value: 6 })
  })

  it('interpolates linearly between measured points', () => {
    expect(dbToPosition(calibration(), -30)).toEqual({ ok: true, value: 6500 })
    expect(positionToDb(calibration(), 6500)).toEqual({ ok: true, value: -30 })
  })

  it('refuses levels outside the measured range', () => {
    expect(dbToPosition(calibration(), 12)).toEqual({
      ok: false,
      error: { kind: 'db-out-of-range', db: 12, min: -Infinity, max: 6 },
    })
    expect(dbToPosition(calibration(), -80).ok).toBe(false)
  })

  it('does not interpolate towards minus infinity', () => {
    expect(positionToDb(calibration(), 500)).toEqual({
      ok: false,
      error: { kind: 'position-out-of-range', position: 500 },
    })
  })
})
