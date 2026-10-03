import type { AnalysisReport, AudioInfo, Finding, StereoImage } from '../analysis/types.js'

const num = (value: number): string => String(Object.is(value, -0) ? 0 : value)

const optional = (value: number | null): string => (value === null ? 'n/a' : num(value))

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

const sourceLine = (role: AnalysisReport['role'], source: AudioInfo): string => {
  const depth = source.bitDepth === null ? [] : [`${num(source.bitDepth)}-bit`]
  const details = [
    `${source.container} ${source.codec}`,
    `${num(source.sampleRate)} Hz`,
    `${num(source.channels)} ch`,
    ...depth,
    `${num(source.durationSeconds)} s`,
  ]
  return `${role}: ${fileName(source.path)} (${details.join(', ')})`
}

const stereoLine = (stereo: StereoImage): string =>
  stereo.kind === 'mono'
    ? 'stereo: mono file'
    : `stereo: correlation ${optional(stereo.correlation)}, side/mid ${num(stereo.sideToMidDb)} dB, mono sum loss ${num(stereo.monoSumLossDb)} dB`

const findingLine = (finding: Finding): string =>
  `- [${finding.severity}] ${finding.code}: ${finding.message}`

export const summariseReportForLlm = (report: AnalysisReport): string => {
  const { loudness, dynamics, spectrum, findings } = report
  return [
    sourceLine(report.role, report.source),
    `loudness: I ${num(loudness.integratedLufs)} LUFS, S max ${num(loudness.shortTermMaxLufs)} LUFS, M max ${num(loudness.momentaryMaxLufs)} LUFS, LRA ${num(loudness.loudnessRangeLu)} LU, true peak ${num(loudness.truePeakDbtp)} dBTP`,
    `dynamics: sample peak ${num(dynamics.samplePeakDbfs)} dBFS, RMS ${num(dynamics.rmsDbfs)} dBFS, crest ${num(dynamics.crestFactorDb)} dB, PLR ${num(dynamics.plrDb)} dB, PSR ${num(dynamics.psrDb)} dB, compression ${dynamics.compression}`,
    `spectrum share: ${spectrum.bands
      .map(
        (band) => `${band.band} ${num(band.lowHz)}-${num(band.highHz)} Hz ${num(band.shareDb)} dB`,
      )
      .join(', ')}`,
    stereoLine(report.stereo),
    findings.length === 0 ? 'findings: none' : 'findings:',
    ...findings.map(findingLine),
  ].join('\n')
}
