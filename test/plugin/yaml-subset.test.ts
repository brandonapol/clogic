import { describe, expect, it } from 'vitest'
import { parseYamlSubset } from './yaml-subset.js'

describe('parseYamlSubset', () => {
  it('parses nested maps, scalar lists and lists of maps', () => {
    const source = [
      'name: Clogic',
      'options:',
      '  deploymentTarget:',
      "    macOS: '15.6'",
      'targets:',
      '  App:',
      '    sources:',
      '      - path: App',
      '        excludes:',
      '          - Info.plist',
      '      - path: Core',
      '    tags:',
      '      - one',
      '      - "two"',
    ].join('\n')
    expect(parseYamlSubset(source)).toEqual({
      name: 'Clogic',
      options: { deploymentTarget: { macOS: '15.6' } },
      targets: {
        App: {
          sources: [{ path: 'App', excludes: ['Info.plist'] }, { path: 'Core' }],
          tags: ['one', 'two'],
        },
      },
    })
  })

  it.each([
    ['flow lists', 'a: [b, c]'],
    ['flow maps', 'a: {b: c}'],
    ['anchors', 'a: &x b'],
    ['tabs', 'a:\n\tb: c'],
    ['duplicate keys', 'a: 1\na: 2'],
    ['keys without values', 'a:\nb: 1'],
    ['trailing comments', 'a: b # note'],
  ])('rejects %s', (_name, source) => {
    expect(() => parseYamlSubset(source)).toThrow()
  })
})
