import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export type Encoding = {
  readonly extension: string
  readonly args: readonly string[]
}

export const pcm = (extension: string, codec: string): Encoding => ({
  extension,
  args: ['-c:a', codec],
})

export const WAV_F32: Encoding = pcm('wav', 'pcm_f32le')

export const dbfs = (db: number): string => (10 ** (db / 20)).toFixed(7)

export const stereoTone = (amplitude: string, hz: number, seconds: number): string =>
  `aevalsrc=${amplitude}*sin(2*PI*${hz}*t)|${amplitude}*sin(2*PI*${hz}*t):s=48000:d=${seconds}`

export const renderLavfi = (
  directory: string,
  name: string,
  source: string,
  encoding: Encoding = WAV_F32,
): string => {
  const path = join(directory, `${name}.${encoding.extension}`)
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, ...encoding.args, path],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`)
  return path
}
