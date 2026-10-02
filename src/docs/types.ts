export type DocTopic = {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly keywords: readonly string[]
}

export type DocLink = {
  readonly title: string
  readonly url: string
  readonly description: string
  readonly score: number
}
