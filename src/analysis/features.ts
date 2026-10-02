import { BROAD_BANDS, binBandIndex, thirdOctaveBands } from './bands.js'
import { powerToDb } from './db.js'
import { createFftTables, fftInPlace, hannWindow } from './fft.js'
import type { Band, BandName, PcmAudio } from './types.js'

export const FFT_SIZE = 8192
export const HOP_SIZE = 4096

export type BroadBandEnergy = {
  readonly band: Band<BandName>
  readonly left: number
  readonly right: number
  readonly mid: number
  readonly side: number
  readonly cross: number
}

export type BandFrames = {
  readonly bands: readonly Band[]
  readonly frameCount: number
  readonly hopSeconds: number
  readonly levelsDb: Float32Array
}

export type TimeDomainStats = {
  readonly sampleCount: number
  readonly samplePeak: number
  readonly meanSquare: number
  readonly sumLeftSquared: number
  readonly sumRightSquared: number
  readonly sumLeftRight: number
}

export type PcmFeatures = {
  readonly sampleRate: number
  readonly isStereo: boolean
  readonly time: TimeDomainStats
  readonly broadBands: readonly BroadBandEnergy[]
  readonly frames: BandFrames
}

const channelPair = (pcm: PcmAudio): readonly [Float32Array, Float32Array] => {
  const left = pcm.channels[0] ?? new Float32Array(0)
  const right = pcm.channels[1] ?? left
  return [left, right]
}

const timeDomainStats = (pcm: PcmAudio): TimeDomainStats => {
  const [left, right] = channelPair(pcm)
  let peak = 0
  let sumSquares = 0
  let count = 0
  for (const channel of pcm.channels) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i] ?? 0
      const magnitude = Math.abs(sample)
      if (magnitude > peak) peak = magnitude
      sumSquares += sample * sample
    }
    count += channel.length
  }
  let ll = 0
  let rr = 0
  let lr = 0
  for (let i = 0; i < left.length; i++) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    ll += l * l
    rr += r * r
    lr += l * r
  }
  return {
    sampleCount: left.length,
    samplePeak: peak,
    meanSquare: count > 0 ? sumSquares / count : 0,
    sumLeftSquared: ll,
    sumRightSquared: rr,
    sumLeftRight: lr,
  }
}

export const analysePcm = (pcm: PcmAudio): PcmFeatures => {
  const [left, right] = channelPair(pcm)
  const isStereo = pcm.channels.length >= 2
  const length = left.length
  const tables = createFftTables(FFT_SIZE)
  const window = hannWindow(FFT_SIZE)
  const windowPower = window.reduce((sum, w) => sum + w * w, 0)
  const scale = 2 / (FFT_SIZE * windowPower)
  const broadIndex = binBandIndex(BROAD_BANDS, FFT_SIZE, pcm.sampleRate)
  const thirds = thirdOctaveBands(pcm.sampleRate)
  const thirdIndex = binBandIndex(thirds, FFT_SIZE, pcm.sampleRate)
  const frameCount = length > FFT_SIZE ? Math.floor((length - FFT_SIZE) / HOP_SIZE) + 1 : 1
  const levelsDb = new Float32Array(frameCount * thirds.length)
  const broad = BROAD_BANDS.map(() => ({ left: 0, right: 0, mid: 0, side: 0, cross: 0 }))
  const thirdPower = new Float64Array(thirds.length)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  const binCount = FFT_SIZE / 2 + 1

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * HOP_SIZE
    for (let i = 0; i < FFT_SIZE; i++) {
      const w = window[i] ?? 0
      re[i] = (left[start + i] ?? 0) * w
      im[i] = isStereo ? (right[start + i] ?? 0) * w : 0
    }
    fftInPlace(re, im, tables)
    thirdPower.fill(0)
    for (let bin = 1; bin < binCount; bin++) {
      const zr = re[bin] ?? 0
      const zi = im[bin] ?? 0
      const nr = re[FFT_SIZE - bin] ?? 0
      const ni = im[FFT_SIZE - bin] ?? 0
      const lr = isStereo ? (zr + nr) / 2 : zr
      const li = isStereo ? (zi - ni) / 2 : zi
      const rr = isStereo ? (zi + ni) / 2 : lr
      const ri = isStereo ? (nr - zr) / 2 : li
      const mr = (lr + rr) / 2
      const mi = (li + ri) / 2
      const midPower = (mr * mr + mi * mi) * scale
      const b = broadIndex[bin] ?? -1
      const acc = broad[b]
      if (acc) {
        const sr = (lr - rr) / 2
        const si = (li - ri) / 2
        acc.left += (lr * lr + li * li) * scale
        acc.right += (rr * rr + ri * ri) * scale
        acc.mid += midPower
        acc.side += (sr * sr + si * si) * scale
        acc.cross += (lr * rr + li * ri) * scale
      }
      const t = thirdIndex[bin] ?? -1
      if (t >= 0) thirdPower[t] = (thirdPower[t] ?? 0) + midPower
    }
    for (let t = 0; t < thirds.length; t++) {
      levelsDb[frame * thirds.length + t] = powerToDb(thirdPower[t] ?? 0)
    }
  }

  return {
    sampleRate: pcm.sampleRate,
    isStereo,
    time: timeDomainStats(pcm),
    broadBands: BROAD_BANDS.map((band, i) => {
      const acc = broad[i] ?? { left: 0, right: 0, mid: 0, side: 0, cross: 0 }
      return {
        band,
        left: acc.left / frameCount,
        right: acc.right / frameCount,
        mid: acc.mid / frameCount,
        side: acc.side / frameCount,
        cross: acc.cross / frameCount,
      }
    }),
    frames: { bands: thirds, frameCount, hopSeconds: HOP_SIZE / pcm.sampleRate, levelsDb },
  }
}
