import { basename } from 'node:path'
import { round } from '../../analysis/db.js'
import { MASKING } from '../../analysis/masking.js'
import type {
  AnalysisReport,
  AudioInfo,
  BandBalance,
  Finding,
  FindingSeverity,
  MaskingConflict,
  ReferenceComparison,
  StemReport,
  StemsReport,
} from '../../analysis/types.js'
import type { JsonObject } from '../../llm/types.js'

export const STEMS_LIMITS = {
  maxStems: 24,
  maxStemFindings: 3,
  maxConflicts: 10,
  maxFindings: 10,
  maxFiles: 100,
} as const

const severityRank: Readonly<Record<FindingSeverity, number>> = {
  problem: 0,
  warning: 1,
  info: 2,
}

export const labelFinding = (finding: Finding): string => `[${finding.severity}] ${finding.message}`

export const labelFindings = (findings: readonly Finding[], limit: number): readonly string[] =>
  [...findings]
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, limit)
    .map(labelFinding)

const dominantBand = (bands: readonly BandBalance[]): string | null =>
  bands.reduce<BandBalance | null>(
    (best, band) => (best === null || band.shareDb > best.shareDb ? band : best),
    null,
  )?.band ?? null

const correlationOf = (report: AnalysisReport): number | null =>
  report.stereo.kind === 'stereo' && report.stereo.correlation !== null
    ? round(report.stereo.correlation, 2)
    : null

const levels = (report: AnalysisReport): JsonObject => ({
  integratedLufs: round(report.loudness.integratedLufs),
  truePeakDbtp: round(report.loudness.truePeakDbtp),
  loudnessRangeLu: round(report.loudness.loudnessRangeLu),
  plrDb: round(report.dynamics.plrDb),
  compression: report.dynamics.compression,
  stereo: report.stereo.kind,
  correlation: correlationOf(report),
})

const stemSummary = (stem: StemReport): JsonObject => ({
  name: stem.name,
  durationSeconds: round(stem.report.source.durationSeconds),
  ...levels(stem.report),
  dominantBand: dominantBand(stem.report.spectrum.bands),
  findings: labelFindings(stem.report.findings, STEMS_LIMITS.maxStemFindings),
  omittedFindings: Math.max(0, stem.report.findings.length - STEMS_LIMITS.maxStemFindings),
})

const conflictSeverity = (conflict: MaskingConflict): FindingSeverity =>
  conflict.overlapRatio >= MASKING.warningOverlapRatio ? 'warning' : 'info'

const conflictSummary = (conflict: MaskingConflict): JsonObject => ({
  severity: conflictSeverity(conflict),
  stems: [conflict.stemA, conflict.stemB],
  rangeHz: `${String(Math.round(conflict.lowHz))}-${String(Math.round(conflict.highHz))}`,
  region: conflict.region,
  overlapPercent: Math.round(conflict.overlapRatio * 100),
  louderStem: conflict.louderStem,
  levelDifferenceDb: round(conflict.levelDifferenceDb),
})

const maskingCodes: readonly string[] = ['stem-masking', 'masking-unavailable']

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`

export const summariseStems = (folder: string, report: StemsReport): JsonObject => {
  const conflicts = report.masking.kind === 'analysed' ? report.masking.conflicts : []
  const warnings = conflicts.filter((c) => conflictSeverity(c) === 'warning').length
  const otherFindings = report.findings.filter((f) => !maskingCodes.includes(f.code))
  const masking: JsonObject =
    report.masking.kind === 'analysed'
      ? {
          status: 'analysed',
          conflictCount: conflicts.length,
          conflicts: conflicts.slice(0, STEMS_LIMITS.maxConflicts).map(conflictSummary),
          omittedConflicts: Math.max(0, conflicts.length - STEMS_LIMITS.maxConflicts),
        }
      : { status: 'unavailable', reason: report.masking.reason }
  const headline =
    report.masking.kind === 'analysed'
      ? `${plural(report.stems.length, 'stem')} analysed; ${plural(conflicts.length, 'masking conflict')} (${plural(warnings, 'warning')}).`
      : `${plural(report.stems.length, 'stem')} analysed; masking unavailable: ${report.masking.reason}.`
  return {
    folder,
    summary: headline,
    stemCount: report.stems.length,
    stems: report.stems.slice(0, STEMS_LIMITS.maxStems).map(stemSummary),
    omittedStems: Math.max(0, report.stems.length - STEMS_LIMITS.maxStems),
    masking,
    findings: labelFindings(otherFindings, STEMS_LIMITS.maxFindings),
  }
}

export const summariseReference = (
  mix: AnalysisReport,
  reference: AnalysisReport,
  comparison: ReferenceComparison,
): JsonObject => ({
  mix: { file: basename(mix.source.path), ...levels(mix) },
  reference: { file: basename(reference.source.path), ...levels(reference) },
  differences: {
    integratedLu: round(comparison.integratedDiffLu),
    truePeakDb: round(comparison.truePeakDiffDb),
    loudnessRangeLu: round(comparison.loudnessRangeDiffLu),
    plrDb: round(comparison.plrDiffDb),
    correlation: comparison.correlationDiff === null ? null : round(comparison.correlationDiff, 2),
  },
  bands: comparison.bands.map((b) => ({
    band: b.band,
    mixShareDb: round(b.mixShareDb),
    referenceShareDb: round(b.referenceShareDb),
    diffDb: round(b.shareDiffDb),
  })),
  findings: labelFindings(comparison.findings, STEMS_LIMITS.maxFindings),
  mixFindings: labelFindings(mix.findings, STEMS_LIMITS.maxStemFindings),
})

export type ProbedFile =
  | { readonly kind: 'probed'; readonly info: AudioInfo }
  | { readonly kind: 'failed'; readonly path: string; readonly message: string }

const fileSummary = (file: ProbedFile): JsonObject =>
  file.kind === 'probed'
    ? {
        name: basename(file.info.path),
        durationSeconds: round(file.info.durationSeconds),
        sampleRate: file.info.sampleRate,
        channels: file.info.channels,
        bitDepth: file.info.bitDepth,
        codec: file.info.codec,
      }
    : { name: basename(file.path), error: file.message }

export const summariseFiles = (
  directory: string,
  totalCount: number,
  files: readonly ProbedFile[],
): JsonObject => ({
  directory,
  fileCount: totalCount,
  files: files.map(fileSummary),
  omittedFiles: Math.max(0, totalCount - files.length),
})
