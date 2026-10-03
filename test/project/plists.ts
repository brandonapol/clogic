export type Real = { readonly real: number }

export type Plain =
  | string
  | number
  | boolean
  | Real
  | Uint8Array
  | readonly Plain[]
  | { readonly [key: string]: Plain }

export const real = (value: number): Real => ({ real: value })

const isReal = (value: Plain): value is Real =>
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array) &&
  Object.keys(value).length === 1 &&
  typeof (value as { readonly real?: unknown }).real === 'number'

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const xmlValue = (value: Plain, indent: string): string => {
  const inner = `${indent}  `
  if (typeof value === 'string') return `${indent}<string>${escapeXml(value)}</string>`
  if (typeof value === 'number') return `${indent}<integer>${value}</integer>`
  if (typeof value === 'boolean') return `${indent}<${value}/>`
  if (value instanceof Uint8Array) {
    return `${indent}<data>${Buffer.from(value).toString('base64')}</data>`
  }
  if (Array.isArray(value)) {
    const items: readonly Plain[] = value
    return [
      `${indent}<array>`,
      ...items.map((item) => xmlValue(item, inner)),
      `${indent}</array>`,
    ].join('\n')
  }
  if (isReal(value)) return `${indent}<real>${value.real}</real>`
  const entries = Object.entries(value as { readonly [key: string]: Plain })
  return [
    `${indent}<dict>`,
    ...entries.flatMap(([key, item]) => [
      `${inner}<key>${escapeXml(key)}</key>`,
      xmlValue(item, inner),
    ]),
    `${indent}</dict>`,
  ].join('\n')
}

export const toXmlPlist = (value: Plain): Uint8Array =>
  new TextEncoder().encode(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      xmlValue(value, ''),
      '</plist>',
      '',
    ].join('\n'),
  )

const lengthMarker = (type: number, length: number): readonly number[] =>
  length < 15 ? [(type << 4) | length] : [(type << 4) | 0x0f, 0x12, ...uint32(length)]

const uint16 = (value: number): readonly number[] => [(value >> 8) & 0xff, value & 0xff]

const uint32 = (value: number): readonly number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

const float64 = (value: number): readonly number[] => {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return [...new Uint8Array(view.buffer)]
}

const int64 = (value: number): readonly number[] => {
  const view = new DataView(new ArrayBuffer(8))
  view.setBigInt64(0, BigInt(value))
  return [...new Uint8Array(view.buffer)]
}

const encodeString = (text: string): readonly number[] =>
  [...text].every((c) => c.charCodeAt(0) < 0x80)
    ? [...lengthMarker(0x5, text.length), ...[...text].map((c) => c.charCodeAt(0))]
    : [
        ...lengthMarker(0x6, text.length),
        ...Array.from({ length: text.length }, (_, i) => uint16(text.charCodeAt(i))).flat(),
      ]

export const toBinaryPlist = (root: Plain): Uint8Array => {
  const objects: (readonly number[])[] = []

  const add = (value: Plain): number => {
    const index = objects.length
    objects.push([])
    const encode = (): readonly number[] => {
      if (typeof value === 'string') return encodeString(value)
      if (typeof value === 'number') return [0x13, ...int64(value)]
      if (typeof value === 'boolean') return [value ? 0x09 : 0x08]
      if (value instanceof Uint8Array) return [...lengthMarker(0x4, value.length), ...value]
      if (Array.isArray(value)) {
        const items: readonly Plain[] = value
        const refs = items.map(add)
        return [...lengthMarker(0xa, refs.length), ...refs.flatMap(uint16)]
      }
      if (isReal(value)) return [0x23, ...float64(value.real)]
      const entries = Object.entries(value as { readonly [key: string]: Plain })
      const keyRefs = entries.map(([key]) => add(key))
      const valueRefs = entries.map(([, item]) => add(item))
      return [...lengthMarker(0xd, entries.length), ...[...keyRefs, ...valueRefs].flatMap(uint16)]
    }
    objects[index] = encode()
    return index
  }

  add(root)
  const header = [...'bplist00'].map((c) => c.charCodeAt(0))
  const offsets = objects.reduce<readonly number[]>(
    (acc, _, i) => [
      ...acc,
      i === 0 ? header.length : (acc[i - 1] ?? 0) + (objects[i - 1]?.length ?? 0),
    ],
    [],
  )
  const body = objects.flat()
  const offsetTableOffset = header.length + body.length
  const trailer = [
    0,
    0,
    0,
    0,
    0,
    0,
    4,
    2,
    ...int64(objects.length),
    ...int64(0),
    ...int64(offsetTableOffset),
  ]
  return new Uint8Array([...header, ...body, ...offsets.flatMap(uint32), ...trailer])
}
