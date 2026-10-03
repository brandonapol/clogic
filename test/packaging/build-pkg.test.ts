import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:os'
import { describe, expect, it } from 'vitest'
import { commandLines, indexOfCommand, packagingDir, runScript } from './run-script.js'

const script = 'pkg/build-pkg.sh'

const env = {
  WORK: '/tmp/clogic-pkg-test',
  CLOGIC_DEVELOPER_ID_APPLICATION: 'test-application-identity',
  CLOGIC_DEVELOPER_ID_INSTALLER: 'test-installer-identity',
  CLOGIC_NOTARY_PROFILE: 'test-notary-profile',
  CLOGIC_PKG_ID_PREFIX: 'org.example.clogic',
  CLOGIC_VERSION: '0.0.1',
  CLOGIC_APP: '/build/clogic.app',
  CLOGIC_COMPANION_BIN: '/build/clogic-companion',
  CLOGIC_FFMPEG_DIR: '/build/ffmpeg',
} as const

const withComponent = { ...env, CLOGIC_COMPONENT: '/build/clogic.component' }

const dryRun = runScript(script, ['--dry-run'], env)
const lines = commandLines(dryRun.stdout)
const signLines = lines.filter((line) => line.startsWith('+ codesign --sign'))

describe('build-pkg.sh --dry-run', () => {
  it('succeeds and prints commands', () => {
    expect(dryRun.status).toBe(0)
    expect(lines.length).toBeGreaterThan(10)
  })

  it('stages helpers inside the app and ffmpeg notices outside Contents/MacOS', () => {
    expect(dryRun.stdout).toContain('/clogic.app/Contents/Helpers/ffmpeg')
    expect(dryRun.stdout).toContain('/clogic.app/Contents/Helpers/clogic-companion')
    expect(dryRun.stdout).toContain(
      '/clogic.app/Contents/Resources/ThirdParty/FFmpeg/SOURCE-OFFER.txt',
    )
  })

  it('checks the bundled ffmpeg licence before signing', () => {
    const assert = indexOfCommand(lines, /assert-lgpl\.sh /)
    const firstSign = indexOfCommand(lines, /^\+ codesign --sign/)
    expect(assert).toBeGreaterThanOrEqual(0)
    expect(assert).toBeLessThan(firstSign)
  })

  it('signs inside out: ffmpeg, ffprobe and companion before the app', () => {
    const at = (pattern: RegExp) => indexOfCommand(signLines, pattern)
    const app = at(/\/clogic\.app$/)
    expect(at(/Helpers\/ffmpeg$/)).toBeLessThan(app)
    expect(at(/Helpers\/ffprobe$/)).toBeLessThan(app)
    expect(at(/Helpers\/clogic-companion$/)).toBeLessThan(app)
    expect(signLines).toHaveLength(4)
  })

  it('uses hardened runtime and secure timestamps, never --deep, when signing', () => {
    for (const line of signLines) {
      expect(line).toContain('--options runtime')
      expect(line).toContain('--timestamp')
      expect(line).not.toContain('--deep')
    }
  })

  it('gives entitlements to the companion only', () => {
    const entitled = signLines.filter((line) => line.includes('--entitlements'))
    expect(entitled).toHaveLength(1)
    expect(entitled[0]).toMatch(/companion\.entitlements .*Helpers\/clogic-companion$/)
  })

  it('reads identities and the notary profile from the environment', () => {
    for (const line of signLines) {
      expect(line).toContain('--sign test-application-identity')
    }
    expect(dryRun.stdout).toMatch(/productbuild .*--sign test-installer-identity/)
    expect(dryRun.stdout).toMatch(/notarytool submit .*--keychain-profile test-notary-profile/)
  })

  it('pins the app as non-relocatable before building the component package', () => {
    const plutil = indexOfCommand(
      lines,
      /plutil -replace 0\.BundleIsRelocatable -bool NO .*app-components/,
    )
    const pkgbuild = indexOfCommand(lines, /pkgbuild --root .*--install-location \/Applications /)
    expect(plutil).toBeGreaterThanOrEqual(0)
    expect(plutil).toBeLessThan(pkgbuild)
  })

  it('orders productbuild, notarytool, stapler and spctl', () => {
    const app = indexOfCommand(lines, /^\+ codesign --sign .*\/clogic\.app$/)
    const verify = indexOfCommand(lines, /codesign --verify --strict/)
    const product = indexOfCommand(lines, /^\+ productbuild /)
    const notarise = indexOfCommand(lines, /notarytool submit .*--wait/)
    const staple = indexOfCommand(lines, /stapler staple /)
    const validate = indexOfCommand(lines, /stapler validate /)
    const assess = indexOfCommand(lines, /spctl --assess .*--type install /)
    expect(app).toBeLessThan(verify)
    expect(verify).toBeLessThan(product)
    expect(product).toBeLessThan(notarise)
    expect(notarise).toBeLessThan(staple)
    expect(staple).toBeLessThan(validate)
    expect(validate).toBeLessThan(assess)
  })

  it('writes an arm64, macOS 15.6+ distribution without the component by default', () => {
    expect(dryRun.stdout).toContain('hostArchitectures="arm64"')
    expect(dryRun.stdout).toContain('<os-version min="15.6"/>')
    expect(dryRun.stdout).toContain('<pkg-ref id="org.example.clogic.app"')
    expect(dryRun.stdout).not.toContain('component.pkg')
  })

  it('prints placeholders instead of failing when variables are missing', () => {
    const bare = runScript(script, ['--dry-run'])
    expect(bare.status).toBe(0)
    expect(bare.stdout).toContain('--sign <CLOGIC_DEVELOPER_ID_APPLICATION>')
    expect(bare.stdout).toContain('--sign <CLOGIC_DEVELOPER_ID_INSTALLER>')
    expect(bare.stdout).toContain('--keychain-profile <CLOGIC_NOTARY_PROFILE>')
  })
})

describe('build-pkg.sh with an AUv2 component', () => {
  const result = runScript(script, ['--dry-run'], withComponent)
  const all = commandLines(result.stdout)

  it('signs the component after the app and packages it for the Components folder', () => {
    const app = indexOfCommand(all, /^\+ codesign --sign .*\/clogic\.app$/)
    const component = indexOfCommand(all, /^\+ codesign --sign .*\/clogic\.component$/)
    expect(app).toBeLessThan(component)
    expect(result.stdout).toMatch(
      /pkgbuild --root .*--install-location \/Library\/Audio\/Plug-Ins\/Components .*component\.pkg/,
    )
    expect(result.stdout).toContain('<pkg-ref id="org.example.clogic.component"')
  })
})

describe('build-pkg.sh --skip-notarize', () => {
  const result = runScript(script, ['--dry-run', '--skip-notarize'], env)

  it('stops after productbuild', () => {
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('productbuild')
    expect(result.stdout).not.toContain('notarytool')
    expect(result.stdout).not.toContain('stapler')
  })
})

describe('build-pkg.sh real run', () => {
  it.skipIf(platform() === 'darwin')('refuses to run off macOS', () => {
    const result = runScript(script, [], env)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('needs macOS')
  })

  it('rejects unknown options', () => {
    expect(runScript(script, ['--identity=x']).status).toBe(2)
  })
})

describe('packaging sources', () => {
  const source = readFileSync(join(packagingDir, 'pkg/build-pkg.sh'), 'utf8')
  const entitlements = readFileSync(
    join(packagingDir, 'pkg/entitlements/companion.entitlements'),
    'utf8',
  )

  it('contains no literal signing identity', () => {
    expect(source).not.toMatch(/Developer ID (Application|Installer): [^<"]/)
    expect(source).not.toMatch(/--sign "[^$]/)
  })

  it('ships a minimal companion entitlement set', () => {
    expect(entitlements).toContain('com.apple.security.cs.allow-jit')
    expect(entitlements).not.toContain('get-task-allow')
    expect(entitlements).not.toContain('disable-library-validation')
  })
})
