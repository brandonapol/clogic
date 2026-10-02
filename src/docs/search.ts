import { topics as defaultTopics, topicUrl } from './topics.js'
import type { DocLink, DocTopic } from './types.js'

const stopWords: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'between',
  'can',
  'difference',
  'do',
  'does',
  'for',
  'get',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'its',
  'logic',
  'make',
  'me',
  'my',
  'of',
  'on',
  'or',
  'pro',
  'the',
  'to',
  'up',
  'use',
  'what',
  'with',
  'work',
])

const phraseWeight = 3
const keywordWeight = 2
const titleWeight = 1

const stem = (word: string): string =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word

export const tokenize = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .map(stem)

const containsSequence = (haystack: readonly string[], needle: readonly string[]): boolean =>
  needle.length > 0 &&
  haystack.some((_, start) => needle.every((word, offset) => haystack[start + offset] === word))

export const scoreTopic = (queryTokens: readonly string[], topic: DocTopic): number => {
  const content = queryTokens.filter((word) => !stopWords.has(word))
  const contentSet = new Set(content)
  const phraseScore = topic.keywords
    .map(tokenize)
    .filter((words) => words.length > 1 && containsSequence(queryTokens, words))
    .reduce((total, words) => total + phraseWeight * words.length, 0)
  const keywordTokens = new Set(topic.keywords.filter((k) => !k.includes(' ')).flatMap(tokenize))
  const keywordScore = [...contentSet].filter((word) => keywordTokens.has(word)).length
  const titleTokens = new Set(tokenize(topic.title))
  const titleScore = [...contentSet].filter((word) => titleTokens.has(word)).length
  return phraseScore + keywordWeight * keywordScore + titleWeight * titleScore
}

export const defaultLimit = 3

export const searchTopics = (
  query: string,
  limit: number = defaultLimit,
  topics: readonly DocTopic[] = defaultTopics,
): readonly DocLink[] => {
  const queryTokens = tokenize(query)
  return topics
    .map((topic, index) => ({ topic, index, score: scoreTopic(queryTokens, topic) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ topic, score }) => ({
      title: topic.title,
      url: topicUrl(topic),
      description: topic.description,
      score,
    }))
}
