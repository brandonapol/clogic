import { describe, expect, it } from 'vitest'
import { fakeBinary, runScript } from './run-script.js'

const lgpl21 = [
  'ffmpeg is free software; you can redistribute it and/or',
  'modify it under the terms of the GNU Lesser General Public',
  'License as published by the Free Software Foundation; either',
  'version 2.1 of the License, or (at your option) any later version.',
  '',
].join('\n')

const lgpl3 = [
  'ffmpeg is free software; you can redistribute it and/or modify',
  'it under the terms of the GNU Lesser General Public License as published by',
  'the Free Software Foundation; either version 3 of the License, or',
  '(at your option) any later version.',
  '',
].join('\n')

const gpl2 = [
  'ffmpeg is free software; you can redistribute it and/or modify',
  'it under the terms of the GNU General Public License as published by',
  'the Free Software Foundation; either version 2 of the License, or',
  '(at your option) any later version.',
  '',
].join('\n')

const nonfree = [
  'This version of ffmpeg has nonfree parts compiled in.',
  'Therefore it is not legally redistributable.',
  '',
].join('\n')

const cleanBuildconf = '  configuration:\n    --disable-gpl\n    --disable-everything\n'

const assertLgpl = (...binaries: readonly string[]) => runScript('ffmpeg/assert-lgpl.sh', binaries)

describe('assert-lgpl.sh', () => {
  it('accepts a default LGPL-2.1-or-later build', () => {
    const result = assertLgpl(fakeBinary('ffmpeg', lgpl21, cleanBuildconf))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK')
  })

  it.each([
    ['GPL', gpl2],
    ['LGPL version 3', lgpl3],
    ['nonfree', nonfree],
    ['empty', ''],
  ])('rejects a %s licence', (_name, licence) => {
    const result = assertLgpl(fakeBinary('ffmpeg', licence, cleanBuildconf))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAIL')
  })

  it.each(['--enable-gpl', '--enable-nonfree', '--enable-version3'])(
    'rejects a buildconf containing %s even if -L says LGPL',
    (flag) => {
      const result = assertLgpl(fakeBinary('ffmpeg', lgpl21, `${cleanBuildconf}    ${flag}\n`))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('-buildconf')
    },
  )

  it('fails if any one of several binaries is not LGPL', () => {
    const result = assertLgpl(
      fakeBinary('ffmpeg', lgpl21, cleanBuildconf),
      fakeBinary('ffprobe', gpl2, cleanBuildconf),
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('OK')
    expect(result.stderr).toMatch(/FAIL .*ffprobe/)
  })

  it('fails on a missing binary and without arguments', () => {
    expect(assertLgpl('/nonexistent/ffmpeg').status).toBe(1)
    expect(assertLgpl().status).toBe(2)
  })
})
