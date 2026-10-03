import { isAbsolute } from 'node:path'
import { analyseFile } from '../analysis/analyse.js'
import { DEFAULT_TOOLS, measureLoudness } from '../analysis/adapter.js'
import type { Result as AnalysisResult } from '../analysis/result.js'
import type { AnalysisError, AnalysisReport, LoudnessMeasurement } from '../analysis/types.js'
import { getLoudnessTool } from '../llm/example-tools.js'
import { err, ok, type Result } from '../llm/result.js'
import type { JsonValue } from '../llm/types.js'
import { defineReadTool } from './define.js'
import { stringParam } from './params.js'
import type { ReadTool, ToolError } from './types.js'

export type AnalysisDeps = {
  readonly analyseFile: (path: string) => Promise<AnalysisResult<AnalysisReport, AnalysisError>>
  readonly measureLoudness: (
    path: string,
  ) => Promise<AnalysisResult<LoudnessMeasurement, AnalysisError>>
}

export const defaultAnalysisDeps: AnalysisDeps = {
  analyseFile: (path) => analyseFile(path, DEFAULT_TOOLS),
  measureLoudness: (path) => measureLoudness(path, DEFAULT_TOOLS),
}

export const describeAnalysisError = (error: AnalysisError): string => {
  switch (error.kind) {
    case 'tool-missing':
      return `${error.tool} is not installed or not on the PATH`
    case 'tool-failed':
      return `${error.tool} failed (exit code ${String(error.exitCode)}): ${error.stderr}`
    case 'no-audio-stream':
      return `${error.path} has no audio stream`
    case 'probe-parse-failed':
      return `Could not read the audio file details: ${error.message}`
    case 'loudness-parse-failed':
      return `Could not read the loudness measurement: ${error.message}`
    case 'empty-audio':
      return `${error.path} contains no audio`
    case 'read-failed':
      return `Could not read ${error.path}: ${error.message}`
    case 'no-stems':
      return `No audio files found in ${error.path}`
    case 'short-decode':
      return `${error.path} decoded ${String(error.decodedFrames)} of ${String(error.expectedFrames)} sample frames, so it was not analysed`
  }
}

const toToolResult = <T extends JsonValue>(
  result: AnalysisResult<T, AnalysisError>,
): Result<JsonValue, ToolError> =>
  result.ok
    ? ok(result.value)
    : err({ kind: 'failed', message: describeAnalysisError(result.error) })

const absolutePath = (path: string): Result<string, ToolError> =>
  isAbsolute(path)
    ? ok(path)
    : err({ kind: 'invalid_input', message: `path must be absolute, got ${path}` })

const pathParam = stringParam('Absolute path to a WAV, AIFF or other ffmpeg-readable audio file.')

export const getLoudness = (deps: AnalysisDeps): ReadTool =>
  defineReadTool({
    name: getLoudnessTool.name,
    description: getLoudnessTool.description,
    surface: 'analysis',
    params: { path: pathParam },
    run: async ({ path }) => {
      const checked = absolutePath(path)
      return checked.ok ? toToolResult(await deps.measureLoudness(checked.value)) : checked
    },
  })

export const analyseMix = (deps: AnalysisDeps): ReadTool =>
  defineReadTool({
    name: 'analyse_mix',
    description:
      'Analyses a bounced mix on disk: EBU R128 loudness and true peak, spectral balance in six ' +
      'bands, stereo image and mono compatibility, dynamics and compression estimate, plus ' +
      'findings that flag likely problems. Use it when the user asks for feedback on a mix or ' +
      'master. It reads the file only and never changes it.',
    surface: 'analysis',
    params: { path: pathParam },
    run: async ({ path }) => {
      const checked = absolutePath(path)
      return checked.ok ? toToolResult(await deps.analyseFile(checked.value)) : checked
    },
  })

export const analysisTools = (deps: AnalysisDeps): readonly ReadTool[] => [
  getLoudness(deps),
  analyseMix(deps),
]
