import { amplitudeToDb, powerRatioDb, powerToDb, round } from './db.js'
import type { BroadBandEnergy, PcmFeatures } from './features.js'
import { reportFindings } from './findings.js'
import type {
  AnalysisReport,
  AudioInfo,
  BandBalance,
  BandStereo,
  CompressionEstimate,
  Dynamics,
  LoudnessMeasurement,
  ReportRole,
  SpectralBalance,
  StereoImage,
} from './types.js'

export const COMPRESSION_PLR_THRESHOLDS = { heavy: 8, moderate: 11, light: 14 } as const

const correlationOf = (cross: number, left: number, right: number): number | null => {
  const denominator = Math.sqrt(left * right)
  return denominator > 0 ? round(cross / denominator, 2) : null
}

export const spectralBalance = (bands: readonly BroadBandEnergy[]): SpectralBalance => {
  const total = bands.reduce((sum, b) => sum + b.mid, 0)
  return {
    bands: bands.map((b): BandBalance => ({
      band: b.band.name,
      lowHz: b.band.lowHz,
      highHz: b.band.highHz,
      levelDbfs: round(powerToDb(b.mid)),
      shareDb: round(powerRatioDb(b.mid, total)),
    })),
  }
}

export const stereoImage = (features: PcmFeatures): StereoImage => {
  if (!features.isStereo) return { kind: 'mono' }
  const { sumLeftSquared: ll, sumRightSquared: rr, sumLeftRight: lr } = features.time
  const mid = (ll + rr + 2 * lr) / 4
  const side = (ll + rr - 2 * lr) / 4
  return {
    kind: 'stereo',
    correlation: correlationOf(lr, ll, rr),
    sideToMidDb: round(powerRatioDb(side, mid)),
    monoSumLossDb: round(powerRatioDb(mid, (ll + rr) / 2)),
    bands: features.broadBands.map((b): BandStereo => ({
      band: b.band.name,
      lowHz: b.band.lowHz,
      highHz: b.band.highHz,
      correlation: correlationOf(b.cross, b.left, b.right),
      sideToMidDb: round(powerRatioDb(b.side, b.mid)),
    })),
  }
}

export const estimateCompression = (plrDb: number): CompressionEstimate => {
  if (plrDb < COMPRESSION_PLR_THRESHOLDS.heavy) return 'heavy'
  if (plrDb < COMPRESSION_PLR_THRESHOLDS.moderate) return 'moderate'
  if (plrDb < COMPRESSION_PLR_THRESHOLDS.light) return 'light'
  return 'minimal'
}

export const dynamics = (features: PcmFeatures, loudness: LoudnessMeasurement): Dynamics => {
  const samplePeakDbfs = amplitudeToDb(features.time.samplePeak)
  const rmsDbfs = powerToDb(features.time.meanSquare)
  const plrDb = loudness.truePeakDbtp - loudness.integratedLufs
  return {
    samplePeakDbfs: round(samplePeakDbfs),
    rmsDbfs: round(rmsDbfs),
    crestFactorDb: round(samplePeakDbfs - rmsDbfs),
    plrDb: round(plrDb),
    psrDb: round(loudness.truePeakDbtp - loudness.shortTermMaxLufs),
    compression: estimateCompression(plrDb),
  }
}

export const buildReport = (
  role: ReportRole,
  source: AudioInfo,
  loudness: LoudnessMeasurement,
  features: PcmFeatures,
): AnalysisReport => {
  const partial = {
    role,
    source,
    loudness,
    spectrum: spectralBalance(features.broadBands),
    stereo: stereoImage(features),
    dynamics: dynamics(features, loudness),
  }
  return { ...partial, findings: reportFindings(partial) }
}
