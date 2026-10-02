import { broadBandAt } from './bands.js'
import { round } from './db.js'
import type { BandFrames } from './features.js'
import type { Finding, MaskingAnalysis, MaskingConflict } from './types.js'

export const MASKING = {
  silenceDb: -70,
  prominenceDb: 15,
  minOverlapRatio: 0.5,
  minActiveFraction: 0.1,
  maxConflicts: 20,
  warningOverlapRatio: 0.8,
} as const

export type StemFrames = {
  readonly name: string
  readonly sampleRate: number
  readonly frames: BandFrames
}

type BandOverlap = {
  readonly ratio: number
  readonly meanDiffDb: number
  readonly flagged: boolean
}

const prominence = (frames: BandFrames, frameCount: number): Uint8Array => {
  const bandCount = frames.bands.length
  const mask = new Uint8Array(frameCount * bandCount)
  for (let f = 0; f < frameCount; f++) {
    let frameMax = -Infinity
    for (let b = 0; b < bandCount; b++) {
      frameMax = Math.max(frameMax, frames.levelsDb[f * bandCount + b] ?? -Infinity)
    }
    for (let b = 0; b < bandCount; b++) {
      const level = frames.levelsDb[f * bandCount + b] ?? -Infinity
      mask[f * bandCount + b] =
        level > MASKING.silenceDb && level >= frameMax - MASKING.prominenceDb ? 1 : 0
    }
  }
  return mask
}

const bandOverlaps = (
  a: BandFrames,
  b: BandFrames,
  aMask: Uint8Array,
  bMask: Uint8Array,
  frameCount: number,
): readonly BandOverlap[] =>
  a.bands.map((_, band) => {
    const bandCount = a.bands.length
    let either = 0
    let both = 0
    let diffSum = 0
    for (let f = 0; f < frameCount; f++) {
      const i = f * bandCount + band
      const inA = aMask[i] === 1
      const inB = bMask[i] === 1
      if (inA || inB) either++
      if (inA && inB) {
        both++
        diffSum += (a.levelsDb[i] ?? 0) - (b.levelsDb[i] ?? 0)
      }
    }
    const ratio = either > 0 ? both / either : 0
    return {
      ratio,
      meanDiffDb: both > 0 ? diffSum / both : 0,
      flagged: ratio >= MASKING.minOverlapRatio && both >= MASKING.minActiveFraction * frameCount,
    }
  })

const groupConflicts = (
  a: StemFrames,
  b: StemFrames,
  overlaps: readonly BandOverlap[],
): readonly MaskingConflict[] => {
  const conflicts: MaskingConflict[] = []
  let runStart = -1
  for (let i = 0; i <= overlaps.length; i++) {
    const flagged = overlaps[i]?.flagged === true
    if (flagged && runStart < 0) runStart = i
    if (!flagged && runStart >= 0) {
      const run = overlaps.slice(runStart, i)
      const low = a.frames.bands[runStart]
      const high = a.frames.bands[i - 1]
      if (low && high) {
        const ratio = run.reduce((sum, o) => sum + o.ratio, 0) / run.length
        const diff = run.reduce((sum, o) => sum + o.meanDiffDb, 0) / run.length
        conflicts.push({
          stemA: a.name,
          stemB: b.name,
          lowHz: Math.round(low.lowHz),
          highHz: Math.round(high.highHz),
          region: broadBandAt(Math.sqrt(low.lowHz * high.highHz)),
          overlapRatio: round(ratio, 2),
          louderStem: diff >= 0 ? a.name : b.name,
          levelDifferenceDb: round(Math.abs(diff)),
        })
      }
      runStart = -1
    }
  }
  return conflicts
}

export const detectMasking = (stems: readonly StemFrames[]): MaskingAnalysis => {
  if (stems.length < 2) {
    return { kind: 'unavailable', reason: 'masking needs at least two stems' }
  }
  const rates = new Set(stems.map((s) => s.sampleRate))
  if (rates.size > 1) {
    return {
      kind: 'unavailable',
      reason: `stems have different sample rates (${[...rates].join(', ')} Hz)`,
    }
  }
  const frameCount = Math.min(...stems.map((s) => s.frames.frameCount))
  const masks = stems.map((s) => prominence(s.frames, frameCount))
  const conflicts: MaskingConflict[] = []
  for (let i = 0; i < stems.length; i++) {
    for (let j = i + 1; j < stems.length; j++) {
      const a = stems[i]
      const b = stems[j]
      const aMask = masks[i]
      const bMask = masks[j]
      if (a && b && aMask && bMask) {
        const overlaps = bandOverlaps(a.frames, b.frames, aMask, bMask, frameCount)
        conflicts.push(...groupConflicts(a, b, overlaps))
      }
    }
  }
  const ranked = [...conflicts].sort(
    (x, y) => y.overlapRatio - x.overlapRatio || x.levelDifferenceDb - y.levelDifferenceDb,
  )
  return { kind: 'analysed', conflicts: ranked.slice(0, MASKING.maxConflicts) }
}

export const maskingFindings = (masking: MaskingAnalysis): readonly Finding[] =>
  masking.kind === 'unavailable'
    ? [{ severity: 'info', code: 'masking-unavailable', message: masking.reason }]
    : masking.conflicts.map((c) => ({
        severity: c.overlapRatio >= MASKING.warningOverlapRatio ? 'warning' : 'info',
        code: 'stem-masking',
        message: `${c.stemA} and ${c.stemB} are both prominent at ${c.lowHz}-${c.highHz} Hz (${c.region}) ${Math.round(c.overlapRatio * 100)}% of the time either is; ${c.louderStem} is ${c.levelDifferenceDb} dB louder there.`,
      }))
