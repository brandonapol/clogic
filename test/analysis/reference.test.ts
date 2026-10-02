import { describe, expect, it } from 'vitest'
import { analysePcm } from '../../src/analysis/features.js'
import { compareToReference } from '../../src/analysis/reference.js'
import { buildReport } from '../../src/analysis/report.js'
import type { AnalysisReport, AudioInfo, LoudnessMeasurement } from '../../src/analysis/types.js'
import { add, mono, sine } from './signals.js'

const info: AudioInfo = {
  path: '/x.wav',
  container: 'wav',
  codec: 'pcm_f32le',
  sampleRate: 48000,
  channels: 1,
  bitDepth: 32,
  sampleFormat: 'flt',
  durationSeconds: 2,
}

const loudness = (integratedLufs: number, truePeakDbtp: number): LoudnessMeasurement => ({
  integratedLufs,
  shortTermMaxLufs: integratedLufs + 2,
  momentaryMaxLufs: integratedLufs + 3,
  loudnessRangeLu: 5,
  loudnessRangeLowLufs: integratedLufs - 4,
  loudnessRangeHighLufs: integratedLufs + 1,
  truePeakDbtp,
})

const reportOf = (signal: Float32Array, integrated: number, peak: number): AnalysisReport =>
  buildReport('mix', info, loudness(integrated, peak), analysePcm(mono(signal)))

describe('compareToReference', () => {
  it('reports a mix with much more low end and loudness than the reference', () => {
    const reference = reportOf(add(sine(100, 0.05, 2), sine(1000, 0.1, 2)), -14, -1)
    const mix = reportOf(add(sine(100, 0.4, 2), sine(1000, 0.1, 2)), -9, -0.5)
    const comparison = compareToReference(mix, reference)
    expect(comparison.integratedDiffLu).toBe(5)
    expect(comparison.truePeakDiffDb).toBe(0.5)
    expect(comparison.plrDiffDb).toBe(-4.5)
    expect(comparison.correlationDiff).toBeNull()
    const low = comparison.bands.find((b) => b.band === 'low')
    expect(low?.shareDiffDb).toBeGreaterThan(3)
    expect(comparison.findings.map((f) => f.code)).toEqual([
      'reference-band-difference',
      'reference-band-difference',
      'reference-loudness-difference',
      'reference-dynamics-difference',
    ])
  })

  it('reports no findings for a mix identical to the reference', () => {
    const signal = add(sine(100, 0.2, 2), sine(1000, 0.1, 2))
    const comparison = compareToReference(reportOf(signal, -14, -1), reportOf(signal, -14, -1))
    expect(comparison.findings).toEqual([])
    expect(comparison.bands.every((b) => b.shareDiffDb === 0)).toBe(true)
  })
})
