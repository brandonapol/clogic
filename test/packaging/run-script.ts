import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const packagingDir = resolve(import.meta.dirname, '../../packaging')

export interface ScriptResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

export const runScript = (
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): ScriptResult => {
  const result = spawnSync('bash', [join(packagingDir, script), ...args], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export const commandLines = (stdout: string): readonly string[] =>
  stdout.split('\n').filter((line) => line.startsWith('+ '))

export const indexOfCommand = (lines: readonly string[], pattern: RegExp): number =>
  lines.findIndex((line) => pattern.test(line))

export const fakeBinary = (name: string, licence: string, buildconf: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'clogic-packaging-'))
  writeFileSync(join(dir, 'licence.txt'), licence)
  writeFileSync(join(dir, 'buildconf.txt'), buildconf)
  const path = join(dir, name)
  writeFileSync(
    path,
    [
      '#!/usr/bin/env bash',
      'dir="$(dirname "$0")"',
      'case " $* " in',
      '  *" -L "*) cat "$dir/licence.txt" ;;',
      '  *" -buildconf "*) cat "$dir/buildconf.txt" ;;',
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
  )
  chmodSync(path, 0o755)
  return path
}
