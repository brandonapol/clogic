export type FftTables = {
  readonly size: number
  readonly bitReversed: Uint32Array
  readonly cos: Float64Array
  readonly sin: Float64Array
}

const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0

export const createFftTables = (size: number): FftTables => {
  if (!isPowerOfTwo(size)) {
    throw new RangeError(`FFT size must be a power of two, got ${size}`)
  }
  const bits = Math.log2(size)
  const bitReversed = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let reversed = 0
    for (let b = 0; b < bits; b++) {
      reversed = (reversed << 1) | ((i >> b) & 1)
    }
    bitReversed[i] = reversed
  }
  const half = size / 2
  const cos = new Float64Array(half)
  const sin = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / size)
    sin[k] = Math.sin((2 * Math.PI * k) / size)
  }
  return { size, bitReversed, cos, sin }
}

export const fftInPlace = (re: Float64Array, im: Float64Array, tables: FftTables): void => {
  const n = tables.size
  for (let i = 0; i < n; i++) {
    const j = tables.bitReversed[i] ?? 0
    if (j > i) {
      const tr = re[i] ?? 0
      const ti = im[i] ?? 0
      re[i] = re[j] ?? 0
      im[i] = im[j] ?? 0
      re[j] = tr
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const wr = tables.cos[k * step] ?? 0
        const wi = -(tables.sin[k * step] ?? 0)
        const a = start + k
        const b = a + half
        const br = re[b] ?? 0
        const bi = im[b] ?? 0
        const tr = br * wr - bi * wi
        const ti = br * wi + bi * wr
        const ar = re[a] ?? 0
        const ai = im[a] ?? 0
        re[b] = ar - tr
        im[b] = ai - ti
        re[a] = ar + tr
        im[a] = ai + ti
      }
    }
  }
}

export const hannWindow = (size: number): Float64Array => {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  }
  return window
}
