import { err, ok, type Result } from './result.js'
import type { AnalysisError, AudioInfo } from './types.js'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const numberField = (record: Readonly<Record<string, unknown>>, key: string): number | null => {
  const value = record[key]
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

const stringField = (record: Readonly<Record<string, unknown>>, key: string): string =>
  typeof record[key] === 'string' ? record[key] : 'unknown'

const parseJson = (json: string): Result<unknown, AnalysisError> => {
  try {
    return ok(JSON.parse(json))
  } catch (error) {
    return err({ kind: 'probe-parse-failed', message: String(error) })
  }
}

export const parseProbeJson = (path: string, json: string): Result<AudioInfo, AnalysisError> => {
  const parsed = parseJson(json)
  if (!parsed.ok) return parsed
  const root = parsed.value
  if (!isRecord(root)) {
    return err({ kind: 'probe-parse-failed', message: 'ffprobe output is not an object' })
  }
  const streams = Array.isArray(root['streams']) ? root['streams'] : []
  const stream: unknown = streams[0]
  if (!isRecord(stream)) return err({ kind: 'no-audio-stream', path })
  const format = isRecord(root['format']) ? root['format'] : {}
  const sampleRate = numberField(stream, 'sample_rate')
  const channels = numberField(stream, 'channels')
  if (sampleRate === null || channels === null || channels < 1) {
    return err({ kind: 'probe-parse-failed', message: 'missing sample rate or channel count' })
  }
  const bitDepth =
    numberField(stream, 'bits_per_raw_sample') ?? numberField(stream, 'bits_per_sample')
  return ok({
    path,
    container: stringField(format, 'format_name'),
    codec: stringField(stream, 'codec_name'),
    sampleRate,
    channels,
    bitDepth: bitDepth !== null && bitDepth > 0 ? bitDepth : null,
    sampleFormat: stringField(stream, 'sample_fmt'),
    durationSeconds: numberField(stream, 'duration') ?? numberField(format, 'duration') ?? 0,
  })
}
