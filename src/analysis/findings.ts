import { DB_FLOOR, round } from './db.js'
import type { AnalysisReport, Finding } from './types.js'

export const THRESHOLDS = {
  silentLufs: -70,
  streamingTargetLufs: -14,
  truePeakCeilingDbtp: -1,
  samplePeakClipDbfs: -0.01,
  heavyLimitingPlrDb: 8,
  negativeCorrelation: 0,
  lowCorrelation: 0.2,
  monoSumLossDb: -4.5,
  lowEndCorrelation: 0.5,
  lowEndSideToMidDb: -10,
} as const

type ReportBody = Omit<AnalysisReport, 'findings'>

const isSilent = (report: ReportBody): boolean =>
  report.loudness.integratedLufs <= THRESHOLDS.silentLufs ||
  report.dynamics.samplePeakDbfs <= DB_FLOOR

const loudnessFindings = (report: ReportBody): readonly Finding[] => {
  const { integratedLufs, truePeakDbtp } = report.loudness
  const findings: Finding[] = []
  if (truePeakDbtp > 0) {
    findings.push({
      severity: 'problem',
      code: 'true-peak-over',
      message: `True peak is ${truePeakDbtp} dBTP, above 0 dBTP: inter-sample overs will clip on conversion or lossy encoding.`,
    })
  } else if (truePeakDbtp > THRESHOLDS.truePeakCeilingDbtp) {
    findings.push({
      severity: 'warning',
      code: 'true-peak-high',
      message: `True peak is ${truePeakDbtp} dBTP, above the common ${THRESHOLDS.truePeakCeilingDbtp} dBTP ceiling for streaming delivery.`,
    })
  }
  if (report.dynamics.samplePeakDbfs >= THRESHOLDS.samplePeakClipDbfs) {
    findings.push({
      severity: 'problem',
      code: 'sample-clipping',
      message: 'Sample peak reaches 0 dBFS: the file is likely clipped.',
    })
  }
  if (report.role === 'mix') {
    const offset = round(integratedLufs - THRESHOLDS.streamingTargetLufs)
    findings.push({
      severity: 'info',
      code: 'streaming-normalisation',
      message:
        offset > 0
          ? `Integrated loudness is ${integratedLufs} LUFS; a ${THRESHOLDS.streamingTargetLufs} LUFS normalising service would turn it down by ${offset} dB.`
          : `Integrated loudness is ${integratedLufs} LUFS, ${-offset} dB below a ${THRESHOLDS.streamingTargetLufs} LUFS normalisation target.`,
    })
  }
  return findings
}

const dynamicsFindings = (report: ReportBody): readonly Finding[] =>
  report.dynamics.plrDb < THRESHOLDS.heavyLimitingPlrDb
    ? [
        {
          severity: 'warning',
          code: 'heavy-limiting',
          message: `Peak-to-loudness ratio is ${report.dynamics.plrDb} dB, which suggests heavy compression or limiting.`,
        },
      ]
    : []

const stereoFindings = (report: ReportBody): readonly Finding[] => {
  const stereo = report.stereo
  if (stereo.kind === 'mono') return []
  const findings: Finding[] = []
  if (stereo.correlation !== null && stereo.correlation < THRESHOLDS.negativeCorrelation) {
    findings.push({
      severity: 'problem',
      code: 'negative-correlation',
      message: `Stereo correlation is ${stereo.correlation}: left and right are largely out of phase and will cancel in mono.`,
    })
  } else if (stereo.correlation !== null && stereo.correlation < THRESHOLDS.lowCorrelation) {
    findings.push({
      severity: 'warning',
      code: 'low-correlation',
      message: `Stereo correlation is ${stereo.correlation}: the image is very wide and may lose focus in mono.`,
    })
  }
  if (stereo.monoSumLossDb < THRESHOLDS.monoSumLossDb) {
    findings.push({
      severity: 'warning',
      code: 'mono-loss',
      message: `Summing to mono loses ${-stereo.monoSumLossDb} dB of energy.`,
    })
  }
  const wideLowEnd = stereo.bands.filter(
    (band) =>
      (band.band === 'sub' || band.band === 'low') &&
      band.sideToMidDb > THRESHOLDS.lowEndSideToMidDb &&
      band.correlation !== null &&
      band.correlation < THRESHOLDS.lowEndCorrelation,
  )
  for (const band of wideLowEnd) {
    findings.push({
      severity: 'warning',
      code: 'wide-low-end',
      message: `The ${band.band} band (${band.lowHz}-${band.highHz} Hz) is wide (side ${band.sideToMidDb} dB vs mid, correlation ${band.correlation}); low end is usually kept near mono.`,
    })
  }
  return findings
}

export const reportFindings = (report: ReportBody): readonly Finding[] => {
  if (isSilent(report)) {
    return [{ severity: 'info', code: 'silent', message: 'The file is silent or nearly silent.' }]
  }
  return [...loudnessFindings(report), ...dynamicsFindings(report), ...stereoFindings(report)]
}
