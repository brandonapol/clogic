import { describe, expect, it } from 'vitest'
import { createFftTables, fftInPlace, hannWindow } from '../../src/analysis/fft.js'

describe('fftInPlace', () => {
  it('turns an impulse into a flat spectrum', () => {
    const re = new Float64Array(16)
    const im = new Float64Array(16)
    re[0] = 1
    fftInPlace(re, im, createFftTables(16))
    expect([...re]).toEqual(Array.from({ length: 16 }, () => 1))
    expect([...im].every((x) => Math.abs(x) < 1e-12)).toBe(true)
  })

  it('puts a bin-centred cosine in its bin', () => {
    const size = 64
    const re = Float64Array.from({ length: size }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / size))
    const im = new Float64Array(size)
    fftInPlace(re, im, createFftTables(size))
    const magnitudes = [...re].map((r, i) => Math.hypot(r, im[i] ?? 0))
    expect(magnitudes[5]).toBeCloseTo(size / 2, 9)
    expect(magnitudes[size - 5]).toBeCloseTo(size / 2, 9)
    expect(magnitudes.filter((m) => m > 1e-9)).toHaveLength(2)
  })

  it('rejects sizes that are not powers of two', () => {
    expect(() => createFftTables(100)).toThrow(RangeError)
  })
})

describe('hannWindow', () => {
  it('is zero at the start and one in the middle', () => {
    const window = hannWindow(8)
    expect(window[0]).toBe(0)
    expect(window[4]).toBeCloseTo(1, 12)
  })
})
