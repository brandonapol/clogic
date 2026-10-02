export const DB_FLOOR = -150
export const DB_CEILING = 150

export const powerToDb = (power: number): number =>
  power > 0 ? Math.min(Math.max(10 * Math.log10(power), DB_FLOOR), DB_CEILING) : DB_FLOOR

export const powerRatioDb = (numerator: number, denominator: number): number => {
  if (denominator > 0) return powerToDb(numerator / denominator)
  return numerator > 0 ? DB_CEILING : DB_FLOOR
}

export const amplitudeToDb = (amplitude: number): number => powerToDb(amplitude * amplitude)

export const dbToAmplitude = (db: number): number => 10 ** (db / 20)

export const round = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}
