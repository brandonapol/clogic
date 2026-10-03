import { describe, expect, it } from 'vitest'
import type { AnalysisReport } from '../../src/analysis/types.js'
import { estimateTokens, summariseReportForLlm } from '../../src/prompts/index.js'

const report: AnalysisReport = {
  role: 'mix',
  source: {
    path: '/Users/someone/Music/Bounces/night drive.wav',
    container: 'wav',
    codec: 'pcm_s24le',
    sampleRate: 48000,
    channels: 2,
    bitDepth: 24,
    sampleFormat: 's32',
    durationSeconds: 201.5,
  },
  loudness: {
    integratedLufs: -8.2,
    shortTermMaxLufs: -6.1,
    momentaryMaxLufs: -4.9,
    loudnessRangeLu: 3.4,
    loudnessRangeLowLufs: -10.2,
    loudnessRangeHighLufs: -6.8,
    truePeakDbtp: 0.4,
  },
  spectrum: {
    bands: [
      { band: 'sub', lowHz: 20, highHz: 60, levelDbfs: -20.1, shareDb: -9.3 },
      { band: 'low', lowHz: 60, highHz: 250, levelDbfs: -15, shareDb: -4.2 },
    ],
  },
  stereo: {
    kind: 'stereo',
    correlation: 0.71,
    sideToMidDb: -11.2,
    monoSumLossDb: -0.6,
    bands: [],
  },
  dynamics: {
    samplePeakDbfs: -0,
    rmsDbfs: -9.9,
    crestFactorDb: 9.9,
    plrDb: 8.6,
    psrDb: 6.5,
    compression: 'moderate',
  },
  findings: [
    {
      severity: 'problem',
      code: 'true-peak-over',
      message: 'True peak is 0.4 dBTP, above 0 dBTP.',
    },
    { severity: 'info', code: 'streaming-normalisation', message: 'Turned down by 5.8 dB.' },
  ],
}

describe('summariseReportForLlm', () => {
  const summary = summariseReportForLlm(report)

  it('describes the source by file name only', () => {
    expect(summary.split('\n')[0]).toBe(
      'mix: night drive.wav (wav pcm_s24le, 48000 Hz, 2 ch, 24-bit, 201.5 s)',
    )
    expect(summary).not.toContain('/Users/someone')
  })

  it('reports loudness with LUFS, LU and dBTP units', () => {
    expect(summary).toContain(
      'loudness: I -8.2 LUFS, S max -6.1 LUFS, M max -4.9 LUFS, LRA 3.4 LU, true peak 0.4 dBTP',
    )
  })

  it('reports dynamics and normalises negative zero', () => {
    expect(summary).toContain(
      'dynamics: sample peak 0 dBFS, RMS -9.9 dBFS, crest 9.9 dB, PLR 8.6 dB, PSR 6.5 dB, compression moderate',
    )
  })

  it('reports band shares with their ranges', () => {
    expect(summary).toContain('spectrum share: sub 20-60 Hz -9.3 dB, low 60-250 Hz -4.2 dB')
  })

  it('reports the stereo image', () => {
    expect(summary).toContain('stereo: correlation 0.71, side/mid -11.2 dB, mono sum loss -0.6 dB')
    expect(
      summariseReportForLlm({
        ...report,
        stereo: { ...report.stereo, correlation: null } as AnalysisReport['stereo'],
      }),
    ).toContain('correlation n/a')
    expect(summariseReportForLlm({ ...report, stereo: { kind: 'mono' } })).toContain(
      'stereo: mono file',
    )
  })

  it('lists every finding with severity and code', () => {
    expect(summary.split('\n').slice(-3)).toEqual([
      'findings:',
      '- [problem] true-peak-over: True peak is 0.4 dBTP, above 0 dBTP.',
      '- [info] streaming-normalisation: Turned down by 5.8 dB.',
    ])
    expect(summariseReportForLlm({ ...report, findings: [] })).toContain('findings: none')
  })

  it('omits an unknown bit depth', () => {
    const noDepth = summariseReportForLlm({
      ...report,
      source: { ...report.source, bitDepth: null },
    })
    expect(noDepth).not.toContain('-bit')
  })

  it('is much more compact than the JSON report', () => {
    expect(estimateTokens(summary)).toBeLessThan(estimateTokens(JSON.stringify(report)))
    expect(estimateTokens(summary)).toBeLessThanOrEqual(200)
  })
})
