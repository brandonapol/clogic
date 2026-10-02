import type { Band, BandName } from './types.js'

export const BROAD_BANDS: readonly Band<BandName>[] = [
  { name: 'sub', lowHz: 20, highHz: 60 },
  { name: 'low', lowHz: 60, highHz: 250 },
  { name: 'lowMid', lowHz: 250, highHz: 500 },
  { name: 'mid', lowHz: 500, highHz: 2000 },
  { name: 'highMid', lowHz: 2000, highHz: 6000 },
  { name: 'air', lowHz: 6000, highHz: 20000 },
] as const

export const thirdOctaveBands = (sampleRate: number): readonly Band[] => {
  const nyquist = sampleRate / 2
  const bands: Band[] = []
  for (let k = -16; k <= 13; k++) {
    const centre = 1000 * 2 ** (k / 3)
    const lowHz = centre * 2 ** (-1 / 6)
    const highHz = Math.min(centre * 2 ** (1 / 6), nyquist)
    if (lowHz < nyquist) {
      bands.push({ name: `${Math.round(centre)} Hz`, lowHz, highHz })
    }
  }
  return bands
}

export const broadBandAt = (hz: number): BandName => {
  const match = BROAD_BANDS.find((band) => hz >= band.lowHz && hz < band.highHz)
  if (match) return match.name
  return hz < 20 ? 'sub' : 'air'
}

export const binBandIndex = (
  bands: readonly Band[],
  fftSize: number,
  sampleRate: number,
): Int16Array => {
  const binCount = fftSize / 2 + 1
  const index = new Int16Array(binCount).fill(-1)
  for (let bin = 1; bin < binCount; bin++) {
    const hz = (bin * sampleRate) / fftSize
    index[bin] = bands.findIndex((band) => hz >= band.lowHz && hz < band.highHz)
  }
  return index
}
