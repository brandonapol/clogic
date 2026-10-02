import { FADER_MAX } from './protocol.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'

export type CalibrationPoint = { readonly position: number; readonly db: number }

export type FaderCalibration = {
  readonly kind: 'fader-calibration'
  readonly points: readonly CalibrationPoint[]
}

export type CalibrationError =
  | { readonly kind: 'too-few-points'; readonly count: number }
  | { readonly kind: 'invalid-point'; readonly point: CalibrationPoint }
  | { readonly kind: 'not-monotonic'; readonly point: CalibrationPoint }

export type LookupError =
  | {
      readonly kind: 'db-out-of-range'
      readonly db: number
      readonly min: number
      readonly max: number
    }
  | { readonly kind: 'position-out-of-range'; readonly position: number }

const validPoint = ({ position, db }: CalibrationPoint): boolean =>
  Number.isInteger(position) &&
  position >= 0 &&
  position <= FADER_MAX &&
  (Number.isFinite(db) || db === -Infinity)

export const faderCalibration = (
  points: readonly CalibrationPoint[],
): Result<FaderCalibration, CalibrationError> => {
  if (points.length < 2) return err({ kind: 'too-few-points', count: points.length })
  const invalid = points.find((point) => !validPoint(point))
  if (invalid !== undefined) return err({ kind: 'invalid-point', point: invalid })
  const sorted = [...points].sort((a, b) => a.position - b.position)
  const unordered = sorted.find((point, index) => {
    const previous = sorted[index - 1]
    return (
      previous !== undefined && (point.position === previous.position || point.db <= previous.db)
    )
  })
  if (unordered !== undefined) return err({ kind: 'not-monotonic', point: unordered })
  return ok({ kind: 'fader-calibration', points: sorted })
}

const segments = (
  points: readonly CalibrationPoint[],
): readonly (readonly [CalibrationPoint, CalibrationPoint])[] =>
  points.flatMap((point, index) => {
    const next = points[index + 1]
    return next === undefined ? [] : [[point, next] as const]
  })

const interpolate = (x: number, x0: number, x1: number, y0: number, y1: number): number =>
  y0 + ((x - x0) * (y1 - y0)) / (x1 - x0)

export const dbToPosition = (
  calibration: FaderCalibration,
  db: number,
): Result<number, LookupError> => {
  const { points } = calibration
  const exact = points.find((point) => point.db === db)
  if (exact !== undefined) return ok(exact.position)
  const segment = segments(points).find(([a, b]) => Number.isFinite(a.db) && a.db < db && db < b.db)
  const min = points[0]?.db ?? -Infinity
  const max = points[points.length - 1]?.db ?? -Infinity
  if (segment === undefined || !Number.isFinite(db)) {
    return err({ kind: 'db-out-of-range', db, min, max })
  }
  const [a, b] = segment
  return ok(Math.round(interpolate(db, a.db, b.db, a.position, b.position)))
}

export const positionToDb = (
  calibration: FaderCalibration,
  position: number,
): Result<number, LookupError> => {
  const { points } = calibration
  const exact = points.find((point) => point.position === position)
  if (exact !== undefined) return ok(exact.db)
  const segment = segments(points).find(
    ([a, b]) => Number.isFinite(a.db) && a.position < position && position < b.position,
  )
  if (segment === undefined) return err({ kind: 'position-out-of-range', position })
  const [a, b] = segment
  return ok(interpolate(position, a.position, b.position, a.db, b.db))
}
