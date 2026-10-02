import { describe, expect, it } from 'vitest'
import { analysePcm } from '../../src/analysis/features.js'
import { detectMasking, maskingFindings, type StemFrames } from '../../src/analysis/masking.js'
import { add, mono, sine, whiteNoise } from './signals.js'

const stem = (name: string, signal: Float32Array, sampleRate = 48000): StemFrames => ({
  name,
  sampleRate,
  frames: analysePcm(mono(signal, sampleRate)).frames,
})

describe('detectMasking', () => {
  it('finds two stems competing at the same low frequency', () => {
    const result = detectMasking([
      stem('kick', sine(80, 0.5, 3)),
      stem('bass', add(sine(80, 0.25, 3), sine(160, 0.05, 3))),
    ])
    expect(result.kind).toBe('analysed')
    if (result.kind !== 'analysed') return
    const conflict = result.conflicts.find((c) => c.lowHz <= 80 && c.highHz >= 80)
    expect(conflict).toMatchObject({
      stemA: 'kick',
      stemB: 'bass',
      region: 'low',
      overlapRatio: 1,
      louderStem: 'kick',
    })
    expect(conflict?.levelDifferenceDb).toBeCloseTo(6, 0)
  })

  it('finds no conflict between stems in different registers', () => {
    const result = detectMasking([stem('bass', sine(80, 0.5, 3)), stem('hat', sine(8000, 0.5, 3))])
    expect(result).toEqual({ kind: 'analysed', conflicts: [] })
  })

  it('ignores a stem that is silent in the shared band', () => {
    const result = detectMasking([
      stem('vocal', sine(1000, 0.3, 3)),
      stem('room', whiteNoise(0.00001, 3, 9)),
    ])
    expect(result).toEqual({ kind: 'analysed', conflicts: [] })
  })

  it('compares only the overlapping duration of stems of different length', () => {
    const result = detectMasking([stem('a', sine(500, 0.3, 3)), stem('b', sine(500, 0.3, 1))])
    expect(result.kind === 'analysed' && result.conflicts.length).toBeGreaterThan(0)
  })

  it('is unavailable for a single stem', () => {
    expect(detectMasking([stem('only', sine(80, 0.5, 1))]).kind).toBe('unavailable')
  })

  it('is unavailable when sample rates differ', () => {
    const result = detectMasking([
      stem('a', sine(80, 0.5, 1)),
      stem('b', sine(80, 0.5, 1, 0, 44100), 44100),
    ])
    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'stems have different sample rates (48000, 44100 Hz)',
    })
  })
})

describe('maskingFindings', () => {
  it('turns conflicts into labelled findings', () => {
    const findings = maskingFindings({
      kind: 'analysed',
      conflicts: [
        {
          stemA: 'kick',
          stemB: 'bass',
          lowHz: 56,
          highHz: 112,
          region: 'low',
          overlapRatio: 0.9,
          louderStem: 'bass',
          levelDifferenceDb: 2.5,
        },
      ],
    })
    expect(findings).toEqual([
      {
        severity: 'warning',
        code: 'stem-masking',
        message:
          'kick and bass are both prominent at 56-112 Hz (low) 90% of the time either is; bass is 2.5 dB louder there.',
      },
    ])
  })
})
