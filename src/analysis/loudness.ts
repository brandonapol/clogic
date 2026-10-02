import { DB_FLOOR } from './db.js'
import { err, ok, type Result } from './result.js'
import type { AnalysisError, LoudnessMeasurement } from './types.js'

const parseLevel = (text: string): number | null => {
  if (/^-inf$/i.test(text)) return DB_FLOOR
  if (/^\+?inf$/i.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? Math.max(value, DB_FLOOR) : null
}

const summaryValue = (summary: string, pattern: RegExp): number | null => {
  const match = pattern.exec(summary)
  return match?.[1] === undefined ? null : parseLevel(match[1])
}

const maxFrameValue = (log: string, key: 'M' | 'S'): number | null => {
  const pattern = new RegExp(`\\b${key}:\\s*(-?[\\d.]+|-inf)`, 'g')
  const values = [...log.matchAll(pattern)]
    .map((match) => (match[1] === undefined ? null : parseLevel(match[1])))
    .filter((value): value is number => value !== null)
  return values.length > 0 ? Math.max(...values) : null
}

export const parseEbur128Log = (stderr: string): Result<LoudnessMeasurement, AnalysisError> => {
  const summaryStart = stderr.lastIndexOf('Summary:')
  if (summaryStart < 0) {
    return err({ kind: 'loudness-parse-failed', message: 'ebur128 summary not found' })
  }
  const frames = stderr.slice(0, summaryStart)
  const summary = stderr.slice(summaryStart)
  const integrated = summaryValue(summary, /I:\s+(\S+)\s+LUFS/)
  const lra = summaryValue(summary, /LRA:\s+(\S+)\s+LU/)
  const lraLow = summaryValue(summary, /LRA low:\s+(\S+)\s+LUFS/)
  const lraHigh = summaryValue(summary, /LRA high:\s+(\S+)\s+LUFS/)
  const truePeak = summaryValue(summary, /True peak:\s*\n\s*Peak:\s+(\S+)\s+dBFS/)
  if (
    integrated === null ||
    lra === null ||
    lraLow === null ||
    lraHigh === null ||
    truePeak === null
  ) {
    return err({ kind: 'loudness-parse-failed', message: 'ebur128 summary is incomplete' })
  }
  return ok({
    integratedLufs: integrated,
    shortTermMaxLufs: maxFrameValue(frames, 'S') ?? integrated,
    momentaryMaxLufs: maxFrameValue(frames, 'M') ?? integrated,
    loudnessRangeLu: lra,
    loudnessRangeLowLufs: lraLow,
    loudnessRangeHighLufs: lraHigh,
    truePeakDbtp: truePeak,
  })
}
