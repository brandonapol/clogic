import { round } from './db.js'
import type { AnalysisReport, BandDifference, Finding, ReferenceComparison } from './types.js'

export const REFERENCE_THRESHOLDS = {
  bandShareDb: 3,
  audibleShareDb: -30,
  integratedLu: 2,
  plrDb: 3,
} as const

const correlationOf = (report: AnalysisReport): number | null =>
  report.stereo.kind === 'stereo' ? report.stereo.correlation : null

const bandFindings = (bands: readonly BandDifference[]): readonly Finding[] =>
  bands
    .filter(
      (b) =>
        Math.abs(b.shareDiffDb) >= REFERENCE_THRESHOLDS.bandShareDb &&
        Math.max(b.mixShareDb, b.referenceShareDb) >= REFERENCE_THRESHOLDS.audibleShareDb,
    )
    .map((b) => ({
      severity: 'warning',
      code: 'reference-band-difference',
      message: `The ${b.band} band carries ${Math.abs(b.shareDiffDb)} dB ${b.shareDiffDb > 0 ? 'more' : 'less'} of the energy than in the reference.`,
    }))

export const compareToReference = (
  mix: AnalysisReport,
  reference: AnalysisReport,
): ReferenceComparison => {
  const bands = mix.spectrum.bands.map((band): BandDifference => {
    const referenceShareDb =
      reference.spectrum.bands.find((b) => b.band === band.band)?.shareDb ?? band.shareDb
    return {
      band: band.band,
      mixShareDb: band.shareDb,
      referenceShareDb,
      shareDiffDb: round(band.shareDb - referenceShareDb),
    }
  })
  const integratedDiffLu = round(mix.loudness.integratedLufs - reference.loudness.integratedLufs)
  const plrDiffDb = round(mix.dynamics.plrDb - reference.dynamics.plrDb)
  const mixCorrelation = correlationOf(mix)
  const refCorrelation = correlationOf(reference)
  const findings: Finding[] = [...bandFindings(bands)]
  if (Math.abs(integratedDiffLu) >= REFERENCE_THRESHOLDS.integratedLu) {
    findings.push({
      severity: 'info',
      code: 'reference-loudness-difference',
      message: `The mix is ${Math.abs(integratedDiffLu)} LU ${integratedDiffLu > 0 ? 'louder' : 'quieter'} than the reference.`,
    })
  }
  if (Math.abs(plrDiffDb) >= REFERENCE_THRESHOLDS.plrDb) {
    findings.push({
      severity: 'info',
      code: 'reference-dynamics-difference',
      message: `The mix has ${Math.abs(plrDiffDb)} dB ${plrDiffDb > 0 ? 'more' : 'less'} peak-to-loudness ratio than the reference.`,
    })
  }
  return {
    integratedDiffLu,
    truePeakDiffDb: round(mix.loudness.truePeakDbtp - reference.loudness.truePeakDbtp),
    loudnessRangeDiffLu: round(mix.loudness.loudnessRangeLu - reference.loudness.loudnessRangeLu),
    plrDiffDb,
    correlationDiff:
      mixCorrelation !== null && refCorrelation !== null
        ? round(mixCorrelation - refCorrelation, 2)
        : null,
    bands,
    findings,
  }
}
