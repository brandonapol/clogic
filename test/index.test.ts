import { describe, expect, it } from 'vitest'
import { name } from '../src/index.js'

describe('clogic', () => {
  it('exports its name', () => {
    expect(name).toBe('clogic')
  })
})
