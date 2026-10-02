import type { AnalysisReport, LoudnessMeasurement } from '../../src/analysis/types.js'

export const loudness: LoudnessMeasurement = {
  integratedLufs: -9.8,
  shortTermMaxLufs: -7.9,
  momentaryMaxLufs: -6.5,
  loudnessRangeLu: 4.2,
  loudnessRangeLowLufs: -12.1,
  loudnessRangeHighLufs: -7.9,
  truePeakDbtp: -0.9,
}

export const mixReport: AnalysisReport = {
  role: 'mix',
  source: {
    path: '/tmp/mix.wav',
    container: 'wav',
    codec: 'pcm_f32le',
    sampleRate: 48000,
    channels: 2,
    bitDepth: 32,
    sampleFormat: 'flt',
    durationSeconds: 180,
  },
  loudness,
  spectrum: { bands: [] },
  stereo: { kind: 'mono' },
  dynamics: {
    samplePeakDbfs: -1.1,
    rmsDbfs: -12.4,
    crestFactorDb: 11.3,
    plrDb: 8.9,
    psrDb: 7.6,
    compression: 'moderate',
  },
  findings: [{ severity: 'warning', code: 'loud-master', message: 'Integrated loudness is high.' }],
}
