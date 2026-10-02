import { isJsonObject } from '../llm/json.js'
import { err, ok, type Result } from '../llm/result.js'
import type { JsonObject, JsonSchemaObject, JsonValue } from '../llm/types.js'

export type StringParam = {
  readonly type: 'string'
  readonly description: string
  readonly required: boolean
}

export type NumberParam = {
  readonly type: 'number'
  readonly description: string
  readonly required: boolean
  readonly minimum: number | null
  readonly maximum: number | null
}

export type BooleanParam = {
  readonly type: 'boolean'
  readonly description: string
  readonly required: boolean
}

export type EnumParam<V extends string = string> = {
  readonly type: 'enum'
  readonly description: string
  readonly required: boolean
  readonly values: readonly V[]
}

export type Param = StringParam | NumberParam | BooleanParam | EnumParam

export type Params = { readonly [name: string]: Param }

type ParamValue<P extends Param> =
  P extends EnumParam<infer V>
    ? V
    : P extends StringParam
      ? string
      : P extends NumberParam
        ? number
        : boolean

type RequiredKeys<P extends Params> = {
  [K in keyof P]: P[K]['required'] extends true ? K : never
}[keyof P]

type OptionalKeys<P extends Params> = Exclude<keyof P, RequiredKeys<P>>

export type ParsedParams<P extends Params> = {
  readonly [K in RequiredKeys<P>]: ParamValue<P[K]>
} & {
  readonly [K in OptionalKeys<P>]?: ParamValue<P[K]>
}

export const stringParam = (description: string) =>
  ({ type: 'string', description, required: true }) as const

export const numberParam = (
  description: string,
  range: { readonly minimum?: number; readonly maximum?: number } = {},
) =>
  ({
    type: 'number',
    description,
    required: true,
    minimum: range.minimum ?? null,
    maximum: range.maximum ?? null,
  }) as const

export const booleanParam = (description: string) =>
  ({ type: 'boolean', description, required: true }) as const

export const enumParam = <const V extends string>(description: string, values: readonly V[]) =>
  ({ type: 'enum', description, required: true, values }) as const

export const optional = <P extends Param>(param: P): P & { readonly required: false } => ({
  ...param,
  required: false,
})

const propertySchema = (param: Param): JsonObject => {
  switch (param.type) {
    case 'string':
    case 'boolean':
      return { type: param.type, description: param.description }
    case 'number':
      return {
        type: 'number',
        description: param.description,
        ...(param.minimum === null ? {} : { minimum: param.minimum }),
        ...(param.maximum === null ? {} : { maximum: param.maximum }),
      }
    case 'enum':
      return { type: 'string', description: param.description, enum: param.values }
  }
}

export const toInputSchema = (params: Params): JsonSchemaObject => ({
  type: 'object',
  properties: Object.fromEntries(
    Object.entries(params).map(([name, param]) => [name, propertySchema(param)]),
  ),
  required: Object.entries(params)
    .filter(([, param]) => param.required)
    .map(([name]) => name),
  additionalProperties: false,
})

const parseValue = (name: string, param: Param, value: JsonValue): Result<JsonValue, string> => {
  switch (param.type) {
    case 'string':
      return typeof value === 'string' ? ok(value) : err(`${name} must be a string`)
    case 'boolean':
      return typeof value === 'boolean' ? ok(value) : err(`${name} must be a boolean`)
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value))
        return err(`${name} must be a number`)
      if (param.minimum !== null && value < param.minimum)
        return err(`${name} must be at least ${param.minimum}`)
      if (param.maximum !== null && value > param.maximum)
        return err(`${name} must be at most ${param.maximum}`)
      return ok(value)
    case 'enum':
      return typeof value === 'string' && param.values.includes(value)
        ? ok(value)
        : err(`${name} must be one of ${param.values.join(', ')}`)
  }
}

export const parseParams = <P extends Params>(
  params: P,
  input: JsonValue,
): Result<ParsedParams<P>, string> => {
  if (!isJsonObject(input)) return err('Input must be a JSON object')
  const unknown = Object.keys(input).filter((key) => !(key in params))
  if (unknown.length > 0) return err(`Unknown parameter: ${unknown.join(', ')}`)
  const entries: (readonly [string, JsonValue])[] = []
  for (const [name, param] of Object.entries(params)) {
    const value = input[name]
    if (value === undefined || value === null) {
      if (param.required) return err(`${name} is required`)
      continue
    }
    const parsed = parseValue(name, param, value)
    if (!parsed.ok) return parsed
    entries.push([name, parsed.value])
  }
  return ok(Object.fromEntries(entries) as ParsedParams<P>)
}
