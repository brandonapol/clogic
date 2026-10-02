export type PcmAudio = {
  readonly sampleRate: number
  readonly channels: readonly Float32Array[]
}

export type AudioInfo = {
  readonly path: string
  readonly container: string
  readonly codec: string
  readonly sampleRate: number
  readonly channels: number
  readonly bitDepth: number | null
  readonly sampleFormat: string
  readonly durationSeconds: number
}

export type LoudnessMeasurement = {
  readonly integratedLufs: number
  readonly shortTermMaxLufs: number
  readonly momentaryMaxLufs: number
  readonly loudnessRangeLu: number
  readonly loudnessRangeLowLufs: number
  readonly loudnessRangeHighLufs: number
  readonly truePeakDbtp: number
}

export type BandName = 'sub' | 'low' | 'lowMid' | 'mid' | 'highMid' | 'air'

export type Band<N extends string = string> = {
  readonly name: N
  readonly lowHz: number
  readonly highHz: number
}

export type BandBalance = {
  readonly band: BandName
  readonly lowHz: number
  readonly highHz: number
  readonly levelDbfs: number
  readonly shareDb: number
}

export type SpectralBalance = {
  readonly bands: readonly BandBalance[]
}

export type BandStereo = {
  readonly band: BandName
  readonly lowHz: number
  readonly highHz: number
  readonly correlation: number | null
  readonly sideToMidDb: number
}

export type StereoImage =
  | { readonly kind: 'mono' }
  | {
      readonly kind: 'stereo'
      readonly correlation: number | null
      readonly sideToMidDb: number
      readonly monoSumLossDb: number
      readonly bands: readonly BandStereo[]
    }

export type CompressionEstimate = 'heavy' | 'moderate' | 'light' | 'minimal'

export type Dynamics = {
  readonly samplePeakDbfs: number
  readonly rmsDbfs: number
  readonly crestFactorDb: number
  readonly plrDb: number
  readonly psrDb: number
  readonly compression: CompressionEstimate
}

export type FindingSeverity = 'info' | 'warning' | 'problem'

export type Finding = {
  readonly severity: FindingSeverity
  readonly code: string
  readonly message: string
}

export type ReportRole = 'mix' | 'stem'

export type AnalysisReport = {
  readonly role: ReportRole
  readonly source: AudioInfo
  readonly loudness: LoudnessMeasurement
  readonly spectrum: SpectralBalance
  readonly stereo: StereoImage
  readonly dynamics: Dynamics
  readonly findings: readonly Finding[]
}

export type MaskingConflict = {
  readonly stemA: string
  readonly stemB: string
  readonly lowHz: number
  readonly highHz: number
  readonly region: BandName
  readonly overlapRatio: number
  readonly louderStem: string
  readonly levelDifferenceDb: number
}

export type MaskingAnalysis =
  | { readonly kind: 'analysed'; readonly conflicts: readonly MaskingConflict[] }
  | { readonly kind: 'unavailable'; readonly reason: string }

export type StemReport = {
  readonly name: string
  readonly report: AnalysisReport
}

export type StemsReport = {
  readonly stems: readonly StemReport[]
  readonly masking: MaskingAnalysis
  readonly findings: readonly Finding[]
}

export type BandDifference = {
  readonly band: BandName
  readonly mixShareDb: number
  readonly referenceShareDb: number
  readonly shareDiffDb: number
}

export type ReferenceComparison = {
  readonly integratedDiffLu: number
  readonly truePeakDiffDb: number
  readonly loudnessRangeDiffLu: number
  readonly plrDiffDb: number
  readonly correlationDiff: number | null
  readonly bands: readonly BandDifference[]
  readonly findings: readonly Finding[]
}

export type AnalysisError =
  | { readonly kind: 'tool-missing'; readonly tool: string }
  | {
      readonly kind: 'tool-failed'
      readonly tool: string
      readonly exitCode: number | null
      readonly stderr: string
    }
  | { readonly kind: 'no-audio-stream'; readonly path: string }
  | { readonly kind: 'probe-parse-failed'; readonly message: string }
  | { readonly kind: 'loudness-parse-failed'; readonly message: string }
  | { readonly kind: 'empty-audio'; readonly path: string }
  | { readonly kind: 'read-failed'; readonly path: string; readonly message: string }
  | { readonly kind: 'no-stems'; readonly path: string }
