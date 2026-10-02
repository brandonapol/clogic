import type { ProviderId } from '../llm/types.js'
import type { ToolKind, ToolSurface } from '../tools/types.js'

export type PromptTool = {
  readonly name: string
  readonly kind: ToolKind
  readonly surface: ToolSurface
}

export type ProjectKey = {
  readonly tonic: string
  readonly mode?: string
}

export type ProjectTimeSignature = {
  readonly numerator: number
  readonly denominator: number
}

export type ProjectSummary = {
  readonly name?: string
  readonly tempoBpm?: number
  readonly sampleRateHz?: number
  readonly key?: ProjectKey
  readonly timeSignature?: ProjectTimeSignature
  readonly trackCount?: number
  readonly logicVersion?: string
}

export type UnitConventions = {
  readonly streamingTargetLufs: number
  readonly truePeakCeilingDbtp: number
}

export type SystemPromptContext = {
  readonly provider: ProviderId
  readonly tools: readonly PromptTool[]
  readonly project?: ProjectSummary
  readonly units?: UnitConventions
}
