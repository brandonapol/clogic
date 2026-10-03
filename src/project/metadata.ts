import { parsePlist } from './plist.js'
import { err, ok, type Result } from './result.js'
import type {
  LogicVersion,
  MetadataError,
  PlistDict,
  PlistValue,
  ProjectInformation,
  SessionFacts,
  SongKey,
  TimeSignature,
} from './types.js'

const numberAt = (dict: PlistDict, key: string): number | undefined => {
  const value = dict.get(key)
  return (value?.kind === 'integer' || value?.kind === 'real') && Number.isFinite(value.value)
    ? value.value
    : undefined
}

const positiveAt = (dict: PlistDict, key: string): number | undefined => {
  const value = numberAt(dict, key)
  return value !== undefined && value > 0 ? value : undefined
}

const countAt = (dict: PlistDict, key: string): number | undefined => {
  const value = numberAt(dict, key)
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined
}

const stringAt = (dict: PlistDict, key: string): string | undefined => {
  const value = dict.get(key)
  return value?.kind === 'string' && value.value.trim() !== '' ? value.value.trim() : undefined
}

const booleanAt = (dict: PlistDict, key: string): boolean | undefined => {
  const value = dict.get(key)
  return value?.kind === 'boolean' ? value.value : undefined
}

const songKey = (dict: PlistDict): SongKey | undefined => {
  const tonic = stringAt(dict, 'SongKey')
  const mode = stringAt(dict, 'SongGenderKey')
  if (tonic === undefined) return undefined
  return mode === undefined ? { tonic } : { tonic, mode }
}

const timeSignature = (dict: PlistDict): TimeSignature | undefined => {
  const numerator = countAt(dict, 'SongSignatureNumerator')
  const denominator = countAt(dict, 'SongSignatureDenominator')
  return numerator !== undefined && denominator !== undefined && numerator > 0 && denominator > 0
    ? { numerator, denominator }
    : undefined
}

const present = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

export const sessionFactsFromDict = (dict: PlistDict): SessionFacts => ({
  ...present('tempoBpm', positiveAt(dict, 'BeatsPerMinute')),
  ...present('sampleRateHz', positiveAt(dict, 'SampleRate')),
  ...present('key', songKey(dict)),
  ...present('timeSignature', timeSignature(dict)),
  ...present('trackCount', countAt(dict, 'NumberOfTracks')),
  ...present('metadataVersion', countAt(dict, 'Version')),
})

export const parseLogicVersion = (raw: string): LogicVersion => {
  const match = /^(.*?)\s+(\d+(?:\.\d+)*)(?:\s*\(([^()]+)\))?$/.exec(raw.trim())
  if (match === null) return { raw }
  return {
    raw,
    ...present('product', match[1]?.trim() || undefined),
    ...present('version', match[2]),
    ...present('build', match[3]?.trim()),
  }
}

export const projectInformationFromDict = (dict: PlistDict): ProjectInformation => {
  const lastSavedFrom = stringAt(dict, 'LastSavedFrom')
  return {
    ...present(
      'savedWith',
      lastSavedFrom === undefined ? undefined : parseLogicVersion(lastSavedFrom),
    ),
    ...present('bundleVersion', stringAt(dict, 'BundleVersion')),
    ...present('hasProjectFolder', booleanAt(dict, 'HasProjectFolder')),
  }
}

const parseDict = (bytes: Uint8Array): Result<PlistDict, MetadataError> => {
  const parsed = parsePlist(bytes)
  if (!parsed.ok) return err({ kind: 'invalid-plist', error: parsed.error })
  const root: PlistValue = parsed.value
  return root.kind === 'dict' ? ok(root.value) : err({ kind: 'not-a-dictionary', found: root.kind })
}

export const parseMetaData = (bytes: Uint8Array): Result<SessionFacts, MetadataError> => {
  const dict = parseDict(bytes)
  return dict.ok ? ok(sessionFactsFromDict(dict.value)) : dict
}

export const parseProjectInformation = (
  bytes: Uint8Array,
): Result<ProjectInformation, MetadataError> => {
  const dict = parseDict(bytes)
  return dict.ok ? ok(projectInformationFromDict(dict.value)) : dict
}
