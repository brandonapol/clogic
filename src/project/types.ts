export type PlistDict = ReadonlyMap<string, PlistValue>

export type PlistValue =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'integer'; readonly value: number }
  | { readonly kind: 'real'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'date'; readonly value: string }
  | { readonly kind: 'data'; readonly value: Uint8Array }
  | { readonly kind: 'uid'; readonly value: number }
  | { readonly kind: 'array'; readonly value: readonly PlistValue[] }
  | { readonly kind: 'dict'; readonly value: PlistDict }

export type PlistError =
  | { readonly kind: 'unsupported-format'; readonly format: string }
  | { readonly kind: 'malformed'; readonly format: 'xml' | 'binary'; readonly message: string }

export type SongKey = {
  readonly tonic: string
  readonly mode?: string
}

export type TimeSignature = {
  readonly numerator: number
  readonly denominator: number
}

export type SessionFacts = {
  readonly tempoBpm?: number
  readonly sampleRateHz?: number
  readonly key?: SongKey
  readonly timeSignature?: TimeSignature
  readonly trackCount?: number
  readonly metadataVersion?: number
}

export type LogicVersion = {
  readonly raw: string
  readonly product?: string
  readonly version?: string
  readonly build?: string
}

export type ProjectInformation = {
  readonly savedWith?: LogicVersion
  readonly bundleVersion?: string
  readonly hasProjectFolder?: boolean
}

export type MetadataError =
  | { readonly kind: 'invalid-plist'; readonly error: PlistError }
  | { readonly kind: 'not-a-dictionary'; readonly found: PlistValue['kind'] }

export type PlistFile<T> =
  | { readonly status: 'read'; readonly value: T }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable'; readonly message: string }
  | { readonly status: 'too-large'; readonly bytes: number }
  | { readonly status: 'invalid'; readonly error: MetadataError }

export type AlternativeMetadata = {
  readonly id: string
  readonly metadata: PlistFile<SessionFacts>
}

export type LogicProjectMetadata = {
  readonly projectInformation: PlistFile<ProjectInformation>
  readonly alternatives: readonly AlternativeMetadata[]
}

export type ProjectReadError =
  | { readonly kind: 'not-found'; readonly path: string }
  | { readonly kind: 'not-a-bundle'; readonly path: string }
  | { readonly kind: 'read-failed'; readonly path: string; readonly message: string }
