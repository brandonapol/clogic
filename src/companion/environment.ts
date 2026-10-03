import { readFileSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { isRecord } from '../llm/json.js'

export type CompanionEnvironment = {
  readonly versions: Readonly<Record<string, string>>
  readonly os: Readonly<Record<string, string>>
}

const packageUrl = new URL('../../package.json', import.meta.url)

export const readPackageVersion = (url: URL = packageUrl): string => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'))
    const version = isRecord(parsed) ? parsed['version'] : undefined
    return typeof version === 'string' && version.length > 0 ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}

export const systemEnvironment = (
  version: string = readPackageVersion(),
): CompanionEnvironment => ({
  versions: { clogic: version, node: process.versions.node },
  os: { platform: platform(), release: release(), arch: arch() },
})
