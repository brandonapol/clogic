import { describe, expect, it } from 'vitest'
import { DB_CEILING, DB_FLOOR } from '../../src/analysis/db.js'
import { analysePcm } from '../../src/analysis/features.js'
import { buildReport, estimateCompression } from '../../src/analysis/report.js'
import type {
  AnalysisReport,
  AudioInfo,
  LoudnessMeasurement,
  PcmAudio,
  ReportRole,
} from '../../src/analysis/types.js'
import { mono, negate, sine, stereo, whiteNoise } from './signals.js'

const info: AudioInfo = {
  path: '/mix.wav',
  container: 'wav',
  codec: 'pcm_f32le',
  sampleRate: 48000,
  channels: 2,
  bitDepth: 32,
  sampleFormat: 'flt',
  durationSeconds: 4,
}

const loudness = (overrides: Partial<LoudnessMeasurement> = {}): LoudnessMeasurement => ({
  integratedLufs: -14,
  shortTermMaxLufs: -12,
  momentaryMaxLufs: -11,
  loudnessRangeLu: 6,
  loudnessRangeLowLufs: -18,
  loudnessRangeHighLufs: -12,
  truePeakDbtp: -1.5,
  ...overrides,
})

const report = (
  pcm: PcmAudio,
  overrides: Partial<LoudnessMeasurement> = {},
  role: ReportRole = 'mix',
): AnalysisReport => buildReport(role, info, loudness(overrides), analysePcm(pcm))

const codes = (r: AnalysisReport): readonly string[] => r.findings.map((f) => f.code)

describe('dynamics', () => {
  it('measures a -20 dBFS sine: peak -20, RMS -23, crest factor 3 dB', () => {
    const r = report(mono(sine(1000, 0.1, 2)), { integratedLufs: -23, truePeakDbtp: -20 })
    expect(r.dynamics.samplePeakDbfs).toBeCloseTo(-20, 1)
    expect(r.dynamics.rmsDbfs).toBeCloseTo(-23, 1)
    expect(r.dynamics.crestFactorDb).toBeCloseTo(3, 1)
    expect(r.dynamics.plrDb).toBe(3)
    expect(r.dynamics.compression).toBe('heavy')
  })

  it('derives PLR and PSR from the loudness measurement', () => {
    const r = report(mono(sine(1000, 0.5, 1)), {
      integratedLufs: -20,
      shortTermMaxLufs: -15,
      truePeakDbtp: -2,
    })
    expect(r.dynamics.plrDb).toBe(18)
    expect(r.dynamics.psrDb).toBe(13)
    expect(r.dynamics.compression).toBe('minimal')
  })

  it('labels compression from PLR thresholds', () => {
    expect(estimateCompression(6)).toBe('heavy')
    expect(estimateCompression(9)).toBe('moderate')
    expect(estimateCompression(12)).toBe('light')
    expect(estimateCompression(15)).toBe('minimal')
  })
})

describe('spectral balance', () => {
  it('puts a 100 Hz sine in the low band at its RMS level', () => {
    const r = report(mono(sine(100, 0.1, 2)))
    const low = r.spectrum.bands.find((b) => b.band === 'low')
    expect(low?.shareDb).toBeCloseTo(0, 1)
    expect(low?.levelDbfs).toBeCloseTo(-23, 0)
    const others = r.spectrum.bands.filter((b) => b.band !== 'low')
    expect(others.every((b) => b.shareDb < -40)).toBe(true)
  })

  it('puts a 3 kHz sine in the high-mid band', () => {
    const r = report(mono(sine(3000, 0.1, 2)))
    const loudest = [...r.spectrum.bands].sort((a, b) => b.shareDb - a.shareDb)[0]
    expect(loudest?.band).toBe('highMid')
  })

  it('splits white noise roughly in proportion to bandwidth', () => {
    const r = report(mono(whiteNoise(0.3, 4, 1)))
    const air = r.spectrum.bands.find((b) => b.band === 'air')
    const mid = r.spectrum.bands.find((b) => b.band === 'mid')
    const total = 20000 - 20
    expect(air?.shareDb).toBeCloseTo(10 * Math.log10(14000 / total), 0)
    expect(mid?.shareDb).toBeCloseTo(10 * Math.log10(1500 / total), 0)
  })
})

describe('stereo image', () => {
  it('reports mono files as mono', () => {
    expect(report(mono(sine(440, 0.1, 1))).stereo).toEqual({ kind: 'mono' })
  })

  it('identical channels: correlation 1, no side, no mono loss', () => {
    const signal = whiteNoise(0.2, 2, 2)
    const s = report(stereo(signal, signal)).stereo
    expect(s.kind).toBe('stereo')
    if (s.kind !== 'stereo') return
    expect(s.correlation).toBe(1)
    expect(s.sideToMidDb).toBe(DB_FLOOR)
    expect(s.monoSumLossDb).toBe(0)
    expect(s.bands.every((b) => b.correlation === 1 || b.correlation === null)).toBe(true)
  })

  it('independent noise: correlation near 0 and 3 dB mono loss', () => {
    const s = report(stereo(whiteNoise(0.2, 4, 3), whiteNoise(0.2, 4, 4))).stereo
    if (s.kind !== 'stereo') throw new Error('expected stereo')
    expect(Math.abs(s.correlation ?? 1)).toBeLessThan(0.05)
    expect(s.monoSumLossDb).toBeCloseTo(-3, 0)
    expect(s.sideToMidDb).toBeCloseTo(0, 0)
  })

  it('flags polarity-inverted channels as a problem', () => {
    const signal = sine(440, 0.2, 2)
    const r = report(stereo(signal, negate(signal)))
    if (r.stereo.kind !== 'stereo') throw new Error('expected stereo')
    expect(r.stereo.correlation).toBe(-1)
    expect(r.stereo.monoSumLossDb).toBe(DB_FLOOR)
    expect(r.stereo.sideToMidDb).toBe(DB_CEILING)
    expect(codes(r)).toContain('wide-low-end')
    expect(codes(r)).toContain('negative-correlation')
    expect(codes(r)).toContain('mono-loss')
  })

  it('flags out-of-phase low end as wide-low-end', () => {
    const r = report(stereo(sine(80, 0.3, 2), sine(80, 0.3, 2, Math.PI / 2)))
    expect(codes(r)).toContain('wide-low-end')
    const low = r.stereo.kind === 'stereo' ? r.stereo.bands.find((b) => b.band === 'low') : null
    expect(low?.correlation).toBeCloseTo(0, 1)
  })

  it('does not flag a centred low end', () => {
    const bass = sine(80, 0.3, 2)
    expect(codes(report(stereo(bass, bass)))).not.toContain('wide-low-end')
  })
})

describe('findings', () => {
  const signal = sine(1000, 0.5, 1)

  it('flags true peak above 0 dBTP as a problem and above -1 dBTP as a warning', () => {
    expect(report(mono(signal), { truePeakDbtp: 0.4 }).findings).toContainEqual(
      expect.objectContaining({ code: 'true-peak-over', severity: 'problem' }),
    )
    expect(report(mono(signal), { truePeakDbtp: -0.5 }).findings).toContainEqual(
      expect.objectContaining({ code: 'true-peak-high', severity: 'warning' }),
    )
    expect(codes(report(mono(signal), { truePeakDbtp: -1.5 }))).not.toContain('true-peak-high')
  })

  it('flags full-scale samples as clipping', () => {
    expect(codes(report(mono(sine(1000, 1, 1)), { truePeakDbtp: 0.6 }))).toContain(
      'sample-clipping',
    )
  })

  it('reports streaming normalisation for mixes but not stems', () => {
    const mix = report(mono(signal), { integratedLufs: -9 })
    expect(mix.findings).toContainEqual(
      expect.objectContaining({
        code: 'streaming-normalisation',
        message: expect.stringContaining('turn it down by 5 dB') as unknown,
      }),
    )
    expect(codes(report(mono(signal), { integratedLufs: -9 }, 'stem'))).not.toContain(
      'streaming-normalisation',
    )
  })

  it('flags heavy limiting from a low PLR', () => {
    expect(codes(report(mono(signal), { integratedLufs: -7, truePeakDbtp: -1 }))).toContain(
      'heavy-limiting',
    )
  })

  it('reports silence and nothing else', () => {
    const silent = report(mono(new Float32Array(48000)), {
      integratedLufs: -70,
      truePeakDbtp: DB_FLOOR,
    })
    expect(codes(silent)).toEqual(['silent'])
  })
})
