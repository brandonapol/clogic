import { analyseFile, analyseStems } from '../../analysis/analyse.js'
import { DEFAULT_TOOLS, listAudioFiles, probeAudio } from '../../analysis/adapter.js'
import { compareToReference } from '../../analysis/reference.js'
import type { Result as AnalysisResult } from '../../analysis/result.js'
import type { AnalysisError, AnalysisReport, AudioInfo, StemsReport } from '../../analysis/types.js'
import { err, ok, type Result } from '../../llm/result.js'
import type { JsonValue } from '../../llm/types.js'
import { describeAnalysisError } from '../analysis.js'
import { defineReadTool } from '../define.js'
import { stringParam } from '../params.js'
import type { ReadTool, ToolError } from '../types.js'
import { statPath, validatePath, type StatPath } from './paths.js'
import {
  STEMS_LIMITS,
  summariseFiles,
  summariseReference,
  summariseStems,
  type ProbedFile,
} from './summary.js'

export type StemsDeps = {
  readonly statPath: StatPath
  readonly listAudioFiles: (
    folder: string,
  ) => Promise<AnalysisResult<readonly string[], AnalysisError>>
  readonly probeAudio: (path: string) => Promise<AnalysisResult<AudioInfo, AnalysisError>>
  readonly analyseFile: (path: string) => Promise<AnalysisResult<AnalysisReport, AnalysisError>>
  readonly analyseStems: (
    paths: readonly string[],
  ) => Promise<AnalysisResult<StemsReport, AnalysisError>>
}

export const defaultStemsDeps: StemsDeps = {
  statPath,
  listAudioFiles,
  probeAudio: (path) => probeAudio(path, DEFAULT_TOOLS),
  analyseFile: (path) => analyseFile(path, DEFAULT_TOOLS),
  analyseStems: (paths) => analyseStems(paths, DEFAULT_TOOLS),
}

export const MAX_ANALYSED_STEMS = 48

const PROBE_CONCURRENCY = 4

const failed = (error: AnalysisError): Result<never, ToolError> =>
  err({ kind: 'failed', message: describeAnalysisError(error) })

const mapLimited = async <T, U>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<readonly U[]> => {
  const chunks = Array.from({ length: Math.ceil(items.length / limit) }, (_, i) =>
    items.slice(i * limit, (i + 1) * limit),
  )
  const results: U[] = []
  for (const chunk of chunks) results.push(...(await Promise.all(chunk.map(fn))))
  return results
}

const folderParam = stringParam('Absolute path to a folder of bounced audio files.')

const listFolder = async (
  deps: StemsDeps,
  folder: string,
): Promise<Result<{ readonly folder: string; readonly files: readonly string[] }, ToolError>> => {
  const checked = await validatePath('folder', folder, 'directory', deps.statPath)
  if (!checked.ok) return checked
  const files = await deps.listAudioFiles(checked.value)
  return files.ok ? ok({ folder: checked.value, files: files.value }) : failed(files.error)
}

export const analyseStemsTool = (deps: StemsDeps): ReadTool =>
  defineReadTool({
    name: 'analyse_stems',
    description:
      'Analyses a folder of bounced stems (one audio file per track or bus): loudness, true ' +
      'peak, dynamics, stereo and dominant band per stem, plus frequency masking conflicts ' +
      'between stems. Use it when the user asks why a mix sounds muddy or crowded, or which ' +
      `parts clash. Only audio files are read and nothing is changed. At most ${String(MAX_ANALYSED_STEMS)} stems.`,
    surface: 'analysis',
    params: { folder: folderParam },
    run: async ({ folder }): Promise<Result<JsonValue, ToolError>> => {
      const listed = await listFolder(deps, folder)
      if (!listed.ok) return listed
      const { files } = listed.value
      if (files.length === 0) return failed({ kind: 'no-stems', path: listed.value.folder })
      if (files.length > MAX_ANALYSED_STEMS) {
        return err({
          kind: 'invalid_input',
          message: `${listed.value.folder} has ${String(files.length)} audio files; analyse_stems handles at most ${String(MAX_ANALYSED_STEMS)}. Point it at a folder with fewer stems.`,
        })
      }
      const report = await deps.analyseStems(files)
      return report.ok
        ? ok(summariseStems(listed.value.folder, report.value))
        : failed(report.error)
    },
  })

export const compareReferenceTool = (deps: StemsDeps): ReadTool =>
  defineReadTool({
    name: 'compare_reference',
    description:
      'Compares a bounced mix with a reference track: loudness, true peak, loudness range, ' +
      'peak-to-loudness ratio, stereo correlation and the energy share of six frequency bands, ' +
      'with findings where the mix differs noticeably. Use it when the user wants their mix to ' +
      'sound more like a commercial track. Both files are only read.',
    surface: 'analysis',
    params: {
      mix: stringParam('Absolute path to the bounced mix audio file.'),
      reference: stringParam('Absolute path to the reference track audio file.'),
    },
    run: async ({ mix, reference }): Promise<Result<JsonValue, ToolError>> => {
      const mixPath = await validatePath('mix', mix, 'audio-file', deps.statPath)
      if (!mixPath.ok) return mixPath
      const referencePath = await validatePath('reference', reference, 'audio-file', deps.statPath)
      if (!referencePath.ok) return referencePath
      if (mixPath.value === referencePath.value) {
        return err({ kind: 'invalid_input', message: 'mix and reference must be different files' })
      }
      const [mixReport, referenceReport] = await Promise.all([
        deps.analyseFile(mixPath.value),
        deps.analyseFile(referencePath.value),
      ])
      if (!mixReport.ok) return failed(mixReport.error)
      if (!referenceReport.ok) return failed(referenceReport.error)
      return ok(
        summariseReference(
          mixReport.value,
          referenceReport.value,
          compareToReference(mixReport.value, referenceReport.value),
        ),
      )
    },
  })

const probeFile =
  (deps: StemsDeps) =>
  async (path: string): Promise<ProbedFile> => {
    const info = await deps.probeAudio(path)
    return info.ok
      ? { kind: 'probed', info: info.value }
      : { kind: 'failed', path, message: describeAnalysisError(info.error) }
  }

export const listAudioFilesTool = (deps: StemsDeps): ReadTool =>
  defineReadTool({
    name: 'list_audio_files',
    description:
      'Lists the audio files (WAV, AIFF, CAF, FLAC, M4A, MP3) directly inside a folder with ' +
      'their duration, sample rate, channel count and bit depth. Use it to find bounces, stems ' +
      'or reference tracks before analysing them. Other files are ignored and nothing is changed.',
    surface: 'analysis',
    params: { folder: folderParam },
    run: async ({ folder }): Promise<Result<JsonValue, ToolError>> => {
      const listed = await listFolder(deps, folder)
      if (!listed.ok) return listed
      const shown = listed.value.files.slice(0, STEMS_LIMITS.maxFiles)
      const probed = await mapLimited(shown, PROBE_CONCURRENCY, probeFile(deps))
      return ok(summariseFiles(listed.value.folder, listed.value.files.length, probed))
    },
  })

export const stemsTools = (deps: StemsDeps): readonly ReadTool[] => [
  analyseStemsTool(deps),
  compareReferenceTool(deps),
  listAudioFilesTool(deps),
]
