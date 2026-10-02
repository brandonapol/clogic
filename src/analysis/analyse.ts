import { basename, extname } from 'node:path'
import {
  DEFAULT_TOOLS,
  decodePcm,
  listAudioFiles,
  measureLoudness,
  probeAudio,
  type Tools,
} from './adapter.js'
import { analysePcm } from './features.js'
import { detectMasking, maskingFindings, type StemFrames } from './masking.js'
import { buildReport } from './report.js'
import { err, ok, type Result } from './result.js'
import type { AnalysisError, AnalysisReport, ReportRole, StemsReport } from './types.js'

type Analysed = {
  readonly report: AnalysisReport
  readonly frames: StemFrames
}

const analyse = async (
  path: string,
  role: ReportRole,
  tools: Tools,
): Promise<Result<Analysed, AnalysisError>> => {
  const info = await probeAudio(path, tools)
  if (!info.ok) return info
  const [pcm, loudness] = await Promise.all([
    decodePcm(info.value, tools),
    measureLoudness(path, tools),
  ])
  if (!pcm.ok) return pcm
  if (!loudness.ok) return loudness
  const features = analysePcm(pcm.value)
  return ok({
    report: buildReport(role, info.value, loudness.value, features),
    frames: {
      name: basename(path, extname(path)),
      sampleRate: features.sampleRate,
      frames: features.frames,
    },
  })
}

export const analyseFile = async (
  path: string,
  tools: Tools = DEFAULT_TOOLS,
): Promise<Result<AnalysisReport, AnalysisError>> => {
  const result = await analyse(path, 'mix', tools)
  return result.ok ? ok(result.value.report) : result
}

const mapLimited = async <T, U>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<readonly U[]> => {
  const results: U[] = new Array<U>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      const item = items[index]
      if (item !== undefined) results[index] = await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export const analyseStems = async (
  paths: readonly string[],
  tools: Tools = DEFAULT_TOOLS,
  concurrency = 4,
): Promise<Result<StemsReport, AnalysisError>> => {
  const results = await mapLimited(paths, concurrency, (path) => analyse(path, 'stem', tools))
  const analysed: Analysed[] = []
  for (const result of results) {
    if (!result.ok) return result
    analysed.push(result.value)
  }
  const masking = detectMasking(analysed.map((a) => a.frames))
  return ok({
    stems: analysed.map((a) => ({ name: a.frames.name, report: a.report })),
    masking,
    findings: maskingFindings(masking),
  })
}

export const analyseStemFolder = async (
  directory: string,
  tools: Tools = DEFAULT_TOOLS,
  concurrency = 4,
): Promise<Result<StemsReport, AnalysisError>> => {
  const files = await listAudioFiles(directory)
  if (!files.ok) return files
  if (files.value.length === 0) return err({ kind: 'no-stems', path: directory })
  return analyseStems(files.value, tools, concurrency)
}
