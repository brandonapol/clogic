import { err, ok } from '../../../src/analysis/result.js'
import type {
  AnalysisReport,
  AudioInfo,
  BandBalance,
  BandName,
  MaskingConflict,
  StemsReport,
} from '../../../src/analysis/types.js'
import type { PathKind, StemsDeps } from '../../../src/tools/stems/index.js'
import { mixReport } from '../fixtures.js'

const bandRanges: readonly (readonly [BandName, number, number])[] = [
  ['sub', 20, 60],
  ['low', 60, 250],
  ['lowMid', 250, 500],
  ['mid', 500, 2000],
  ['highMid', 2000, 6000],
  ['air', 6000, 20000],
]

export const bands = (shares: readonly number[]): readonly BandBalance[] =>
  bandRanges.map(([band, lowHz, highHz], i) => ({
    band,
    lowHz,
    highHz,
    levelDbfs: -20,
    shareDb: shares[i] ?? -40,
  }))

export const audioInfo = (path: string, durationSeconds = 180.04): AudioInfo => ({
  ...mixReport.source,
  path,
  durationSeconds,
})

export const report = (
  path: string,
  overrides: Partial<Omit<AnalysisReport, 'source'>> = {},
): AnalysisReport => ({
  ...mixReport,
  source: audioInfo(path),
  spectrum: { bands: bands([-20, -4.04, -6, -8, -12, -18]) },
  stereo: {
    kind: 'stereo',
    correlation: 0.8349,
    sideToMidDb: -12,
    monoSumLossDb: -0.4,
    bands: [],
  },
  ...overrides,
})

export const conflict = (
  stemA: string,
  stemB: string,
  overlapRatio: number,
  extra: Partial<MaskingConflict> = {},
): MaskingConflict => ({
  stemA,
  stemB,
  lowHz: 63,
  highHz: 250,
  region: 'low',
  overlapRatio,
  louderStem: stemA,
  levelDifferenceDb: 3.14,
  ...extra,
})

export const stemsReport = (names: readonly string[], conflicts: readonly MaskingConflict[]) =>
  ({
    stems: names.map((name) => ({
      name,
      report: report(`/stems/${name}.wav`, { role: 'stem' }),
    })),
    masking: { kind: 'analysed', conflicts },
    findings: [],
  }) satisfies StemsReport

export type FakeFs = Readonly<Record<string, PathKind | readonly string[]>>

export const fakeDeps = (fs: FakeFs, overrides: Partial<StemsDeps> = {}) => {
  const calls: string[] = []
  const deps: StemsDeps = {
    statPath: async (path) => {
      calls.push(`stat ${path}`)
      const entry = fs[path]
      if (entry === undefined) return 'missing'
      return typeof entry === 'string' ? entry : 'directory'
    },
    listAudioFiles: async (folder) => {
      calls.push(`list ${folder}`)
      const entry = fs[folder]
      return typeof entry === 'object'
        ? ok(entry.map((name) => `${folder}/${name}`))
        : err({ kind: 'read-failed', path: folder, message: 'not a folder' })
    },
    probeAudio: async (path) => {
      calls.push(`probe ${path}`)
      return ok(audioInfo(path))
    },
    analyseFile: async (path) => {
      calls.push(`analyse ${path}`)
      return ok(report(path))
    },
    analyseStems: async (paths) => {
      calls.push(`stems ${paths.join(',')}`)
      return ok(stemsReport([], []))
    },
    ...overrides,
  }
  return { deps, calls }
}
