export const DB_FLOOR = -150

export const powerToDb = (power: number): number =>
  power > 0 ? Math.max(10 * Math.log10(power), DB_FLOOR) : DB_FLOOR

export const amplitudeToDb = (amplitude: number): number => powerToDb(amplitude * amplitude)

export const dbToAmplitude = (db: number): number => 10 ** (db / 20)

export const round = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}
