import { spawnSync } from 'node:child_process'
import type { PcmAudio } from '../../src/analysis/types.js'

export const SAMPLE_RATE = 48000

export const sine = (
  hz: number,
  amplitude: number,
  seconds: number,
  phase = 0,
  sampleRate = SAMPLE_RATE,
): Float32Array =>
  Float32Array.from(
    { length: Math.round(seconds * sampleRate) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate + phase),
  )

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const whiteNoise = (amplitude: number, seconds: number, seed: number): Float32Array => {
  const random = mulberry32(seed)
  return Float32Array.from(
    { length: Math.round(seconds * SAMPLE_RATE) },
    () => amplitude * (random() * 2 - 1),
  )
}

export const negate = (signal: Float32Array): Float32Array => signal.map((x) => -x)

export const add = (a: Float32Array, b: Float32Array): Float32Array =>
  a.map((x, i) => x + (b[i] ?? 0))

export const mono = (signal: Float32Array, sampleRate = SAMPLE_RATE): PcmAudio => ({
  sampleRate,
  channels: [signal],
})

export const stereo = (
  left: Float32Array,
  right: Float32Array,
  sampleRate = SAMPLE_RATE,
): PcmAudio => ({ sampleRate, channels: [left, right] })

export const hasFfmpeg = (): boolean =>
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
