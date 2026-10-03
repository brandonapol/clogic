import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { providerIds } from '../../src/llm/types.js'
import { rpcErrorCodes } from '../../src/rpc/jsonrpc.js'
import {
  changeStatuses,
  companionNotificationDecoders,
  pluginNotificationDecoders,
  requestDecoders,
  turnEndReasons,
} from '../../src/rpc/messages.js'
import { protocolVersion } from '../../src/rpc/handshake.js'
import {
  sampleCompanionNotifications,
  samplePluginNotifications,
  sampleParams,
  sampleResults,
} from '../rpc/fixtures.js'
import { parseYamlSubset, type YamlValue } from './yaml-subset.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const plugin = join(root, 'plugin')
const read = (path: string) => readFileSync(join(plugin, path), 'utf8')

const walk = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const files = walk(plugin)
const withExtension = (extension: string) => files.filter((path) => path.endsWith(extension))
const swiftSources = withExtension('.swift')
const swift = (name: string) => read(name)

type YamlMap = { readonly [key: string]: YamlValue }

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === 'object' && !Array.isArray(value)

const map = (value: YamlValue | undefined, path: string): YamlMap => {
  if (!isMap(value)) throw new Error(`${path} is not a map`)
  return value
}

const list = (value: YamlValue | undefined, path: string): readonly YamlValue[] => {
  if (!Array.isArray(value)) throw new Error(`${path} is not a list`)
  return value
}

const project = map(parseYamlSubset(read('project.yml')), 'project')
const targets = map(project['targets'], 'targets')
const target = (name: string) => map(targets[name], name)
const targetSettings = (name: string) =>
  map(map(target(name)['settings'], `${name}.settings`)['base'], `${name}.settings.base`)

const allSettings = (): readonly YamlMap[] => {
  const projectSettings = map(project['settings'], 'settings')
  const configs = map(projectSettings['configs'], 'settings.configs')
  return [
    map(projectSettings['base'], 'settings.base'),
    ...Object.keys(configs).map((name) => map(configs[name], name)),
    ...Object.keys(targets).map(targetSettings),
  ]
}

type PlistValue = boolean | string | readonly string[]

const parseEntitlements = (xml: string): Readonly<Record<string, PlistValue>> => {
  if (/<dict\s*\/>/.test(xml)) return {}
  const body = /<plist[^>]*>\s*<dict>([\s\S]*)<\/dict>\s*<\/plist>/.exec(xml)?.[1]
  if (body === undefined) throw new Error('not a plist dict')
  const entry =
    /<key>([^<]+)<\/key>\s*(<true\/>|<false\/>|<string>([^<]*)<\/string>|<array>([\s\S]*?)<\/array>)/g
  return Object.fromEntries(
    Array.from(body.matchAll(entry), (match): [string, PlistValue] => {
      const [, key = '', raw = '', text, items] = match
      if (raw === '<true/>') return [key, true]
      if (raw === '<false/>') return [key, false]
      if (text !== undefined) return [key, text]
      return [
        key,
        Array.from((items ?? '').matchAll(/<string>([^<]*)<\/string>/g), (m) => m[1] ?? ''),
      ]
    }),
  )
}

const enumCases = (source: string, name: string): readonly string[] => {
  const body = new RegExp(`enum ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1]
  if (body === undefined) throw new Error(`enum ${name} not found`)
  return Array.from(
    body.matchAll(/^\s*case (\w+)(?: = "([^"]+)")?\s*$/gm),
    (match) => match[2] ?? match[1] ?? '',
  )
}

const structFields = (source: string, name: string): readonly string[] => {
  const body = new RegExp(`struct ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1]
  if (body === undefined) throw new Error(`struct ${name} not found`)
  return Array.from(body.matchAll(/^ {4}public let (\w+):/gm), (match) => match[1] ?? '')
}

const keysOf = (value: object) => Object.keys(value).sort()
const sorted = (values: readonly string[]) => [...values].sort()

describe('plugin/project.yml', () => {
  it('defines the container app, the AUv3 extension and the core test bundle', () => {
    expect(project['name']).toBe('Clogic')
    expect(Object.keys(targets).sort()).toEqual(['ClogicApp', 'ClogicCoreTests', 'ClogicExtension'])
    expect(target('ClogicApp')['type']).toBe('application')
    expect(target('ClogicExtension')['type']).toBe('app-extension')
    expect(target('ClogicCoreTests')['type']).toBe('bundle.unit-test')
    Object.keys(targets).forEach((name) => expect(target(name)['platform']).toBe('macOS'))
  })

  it('embeds the extension in the app', () => {
    expect(list(target('ClogicApp')['dependencies'], 'dependencies')).toContainEqual({
      target: 'ClogicExtension',
      embed: 'true',
    })
  })

  it('targets arm64 on macOS 15.6 with the hardened runtime, per SPIKE-010', () => {
    const base = map(map(project['settings'], 'settings')['base'], 'base')
    expect(map(map(project['options'], 'options')['deploymentTarget'], 'dt')['macOS']).toBe('15.6')
    expect(base['MACOSX_DEPLOYMENT_TARGET']).toBe('15.6')
    expect(base['ARCHS']).toBe('arm64')
    expect(base['ENABLE_HARDENED_RUNTIME']).toBe('YES')
    expect(targetSettings('ClogicApp')['ENABLE_HARDENED_RUNTIME']).toBeUndefined()
    expect(targetSettings('ClogicExtension')['ENABLE_HARDENED_RUNTIME']).toBeUndefined()
  })

  it('does not inject get-task-allow into Release builds', () => {
    const configs = map(map(project['settings'], 'settings')['configs'], 'configs')
    expect(map(configs['Release'], 'Release')['CODE_SIGN_INJECT_BASE_ENTITLEMENTS']).toBe('NO')
  })

  it('takes the signing identity and team from build settings, never literals', () => {
    const signingKeys = ['DEVELOPMENT_TEAM', 'CODE_SIGN_IDENTITY', 'PROVISIONING_PROFILE_SPECIFIER']
    allSettings().forEach((settings) =>
      signingKeys.forEach((key) => {
        const value = settings[key]
        if (value !== undefined) expect(value).toMatch(/^(?:|-|\$\(\w+\))$/)
      }),
    )
    const xcconfig = read('Config/Signing.xcconfig')
    expect(xcconfig).toMatch(/^DEVELOPMENT_TEAM = \$\(CLOGIC_TEAM_ID\)$/m)
    expect(xcconfig).toMatch(/^CODE_SIGN_IDENTITY = \$\(CLOGIC_CODE_SIGN_IDENTITY\)$/m)
    expect(xcconfig).toMatch(/^CLOGIC_TEAM_ID =$/m)
    expect(xcconfig).toMatch(/^#include\? "Local\.xcconfig"$/m)
    expect(read('.gitignore')).toMatch(/^Config\/Local\.xcconfig$/m)
  })

  it('points every source, plist and entitlements path at a file that exists', () => {
    Object.keys(targets).forEach((name) => {
      list(target(name)['sources'], `${name}.sources`).forEach((source) => {
        const path = typeof source === 'string' ? source : map(source, 'source')['path']
        expect(
          typeof path === 'string' && existsSync(join(plugin, path)),
          `${name}: ${String(path)}`,
        ).toBe(true)
      })
      const settings = targetSettings(name)
      ;['INFOPLIST_FILE', 'CODE_SIGN_ENTITLEMENTS'].forEach((key) => {
        const path = settings[key]
        if (path !== undefined)
          expect(existsSync(join(plugin, String(path))), `${name}: ${String(path)}`).toBe(true)
      })
    })
  })

  it('compiles the pure core into the test bundle and ships the web UI as a folder resource', () => {
    const testSources = list(target('ClogicCoreTests')['sources'], 'tests')
    expect(testSources).toContainEqual({ path: 'Core' })
    expect(testSources).toContainEqual({
      path: 'Tests/Vectors',
      type: 'folder',
      buildPhase: 'resources',
    })
    expect(list(target('ClogicExtension')['sources'], 'ext')).toContainEqual({
      path: 'Web',
      type: 'folder',
      buildPhase: 'resources',
    })
    expect(files.some((path) => path.includes('.xcodeproj'))).toBe(false)
  })
})

describe('plugin entitlements and Info.plist', () => {
  it('gives the extension only the sandbox, the team app group and network.client', () => {
    expect(parseEntitlements(read('Extension/Extension.entitlements'))).toEqual({
      'com.apple.security.app-sandbox': true,
      'com.apple.security.application-groups': ['$(TeamIdentifierPrefix)clogic'],
      'com.apple.security.network.client': true,
    })
  })

  it('gives the container app no entitlements', () => {
    expect(parseEntitlements(read('App/App.entitlements'))).toEqual({})
  })

  it('never asks for debugging or runtime exceptions', () => {
    const forbidden =
      /get-task-allow|cs\.allow-jit|cs\.disable-library-validation|cs\.allow-unsigned|cs\.disable-executable/
    withExtension('.entitlements').forEach((path) =>
      expect(readFileSync(path, 'utf8')).not.toMatch(forbidden),
    )
  })

  it('declares an Audio Effect (aufx) AUv3 extension with the view controller as principal class', () => {
    const info = read('Extension/Info.plist')
    expect(info).toMatch(/<key>type<\/key>\s*<string>aufx<\/string>/)
    expect(info).toMatch(
      /<key>NSExtensionPointIdentifier<\/key>\s*<string>com\.apple\.AudioUnit-UI<\/string>/,
    )
    expect(info).toMatch(
      /<key>NSExtensionPrincipalClass<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.AudioUnitViewController<\/string>/,
    )
    expect(swift('Extension/AudioUnitViewController.swift')).toMatch(
      /class AudioUnitViewController: AUViewController, AUAudioUnitFactory/,
    )
  })

  it('tells the extension its app group under the key the Swift code reads', () => {
    expect(read('Extension/Info.plist')).toMatch(
      /<key>ClogicAppGroupIdentifier<\/key>\s*<string>\$\(DEVELOPMENT_TEAM\)\.clogic<\/string>/,
    )
    expect(swift('Core/Paths.swift')).toContain('appGroupInfoKey = "ClogicAppGroupIdentifier"')
    expect(swift('Core/Paths.swift')).toContain('fileName = "c.sock"')
  })
})

describe('plugin web assets', () => {
  const webFiles = files.filter((path) => path.includes(`${join(plugin, 'Web')}/`))
  const html = read('Web/index.html')
  const js = read('Web/app.js')

  it('bundles only static HTML, CSS and JS', () => {
    expect(webFiles.map((path) => relative(plugin, path)).sort()).toEqual([
      'Web/app.js',
      'Web/index.html',
      'Web/styles.css',
    ])
  })

  it('references no external URLs', () => {
    webFiles.forEach((path) => {
      const text = readFileSync(path, 'utf8')
      expect(text, path).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i)
      expect(text, path).not.toMatch(/(?:src|href)\s*=\s*["']\/\//i)
      expect(text, path).not.toMatch(/@import|url\(/i)
    })
  })

  it('loads only local files and in-page fragments', () => {
    const refs = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1] ?? '')
    refs.forEach((ref) => {
      if (ref.startsWith('#')) return
      expect(existsSync(join(plugin, 'Web', ref)), ref).toBe(true)
    })
  })

  it('blocks network access with a content security policy', () => {
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("form-action 'none'")
  })

  it('never stores keys or anything else in the page', () => {
    expect(js).not.toMatch(
      /localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|fetch\(|XMLHttpRequest|WebSocket|EventSource|\beval\(|new Function|innerHTML|outerHTML|insertAdjacentHTML/,
    )
    expect(html).toMatch(/<input\s+id="api-key"\s+type="password"\s+autocomplete="off"/)
    expect(js).toMatch(/els\.apiKey\.value = ''/)
  })
})

describe('plugin secrets', () => {
  const tokenPatterns = [
    /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
    /xai-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /gh[pousr]_[A-Za-z0-9]{30,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /(?:DEVELOPMENT_TEAM|CLOGIC_TEAM_ID)\s*[:=]\s*['"]?[A-Z0-9]{10}\b/,
    /Developer ID (?:Application|Installer): [A-Za-z]/,
    /AIza[0-9A-Za-z_-]{35}/,
  ]

  it('contains no token-like literals', () => {
    files.forEach((path) => {
      const text = readFileSync(path, 'utf8')
      tokenPatterns.forEach((pattern) =>
        expect(text, `${relative(root, path)} ${pattern}`).not.toMatch(pattern),
      )
    })
  })

  it('has no comments in Swift or JS sources', () => {
    ;[...swiftSources, ...withExtension('.js')].forEach((path) => {
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, index) =>
        expect(line, `${relative(root, path)}:${index + 1}`).not.toMatch(
          /^\s*(?:\/\/|\/\*|\*\/)|\s\/\/\s/,
        ),
      )
    })
  })
})

describe('Swift codables match src/rpc', () => {
  const messages = swift('Core/RpcMessages.swift')

  it('names every request and notification method exactly like the companion', () => {
    expect(sorted(enumCases(messages, 'RequestMethod'))).toEqual(
      sorted(Object.keys(requestDecoders)),
    )
    expect(sorted(enumCases(messages, 'PluginNotificationMethod'))).toEqual(
      sorted(Object.keys(pluginNotificationDecoders)),
    )
    expect(sorted(enumCases(messages, 'CompanionNotificationMethod'))).toEqual(
      sorted(Object.keys(companionNotificationDecoders)),
    )
  })

  it('uses the same enum values', () => {
    expect(sorted(enumCases(messages, 'ProviderId'))).toEqual(sorted(providerIds))
    expect(sorted(enumCases(messages, 'TurnEndReason'))).toEqual(sorted(turnEndReasons))
    expect(sorted(enumCases(messages, 'ChangeStatus'))).toEqual(sorted(changeStatuses))
    expect(sorted(enumCases(messages, 'ToolKind'))).toEqual(['change', 'read'])
    expect(sorted(enumCases(messages, 'ToolStatus'))).toEqual(['error', 'ok', 'proposed'])
    expect(sorted(enumCases(messages, 'DecideOutcome'))).toEqual(['applying', 'declined'])
  })

  const requestTypes = {
    'session.hello': ['SessionHelloParams', 'SessionHelloResult'],
    'chat.send': ['ChatSendParams', 'ChatSendResult'],
    'chat.cancel': ['ChatCancelParams', 'ChatCancelResult'],
    'change.decide': ['ChangeDecideParams', 'ChangeDecideResult'],
    'keys.set': ['KeysSetParams', 'KeyStatus'],
    'keys.status': ['KeysStatusParams', 'KeysStatusResult'],
    'provider.select': ['ProviderSelectParams', 'ProviderSelectResult'],
    'diagnostics.export': ['DiagnosticsExportParams', 'DiagnosticsExportResult'],
  } as const

  it('covers every request method', () => {
    expect(sorted(Object.keys(requestTypes))).toEqual(sorted(Object.keys(requestDecoders)))
  })

  it.each(Object.entries(requestTypes))(
    '%s params and result fields match',
    (method, [params, result]) => {
      const key = method as keyof typeof requestTypes
      expect(sorted(structFields(messages, params))).toEqual(keysOf(sampleParams[key]))
      expect(sorted(structFields(messages, result))).toEqual(keysOf(sampleResults[key]))
      expect(messages).toMatch(
        new RegExp(`struct ${params}\\b[\\s\\S]*?static let method = RequestMethod\\.\\w+`),
      )
    },
  )

  const pluginNotificationTypes = {
    meter: 'MeterParams',
    'context.changed': 'ContextChangedParams',
  } as const

  it.each(Object.entries(pluginNotificationTypes))('%s fields match', (method, name) => {
    expect(sorted(structFields(messages, name))).toEqual(
      keysOf(samplePluginNotifications[method as keyof typeof pluginNotificationTypes]),
    )
  })

  const companionNotificationTypes = {
    'chat.message': 'ChatMessageParams',
    'chat.delta': 'ChatDeltaParams',
    'chat.done': 'ChatDoneParams',
    'tool.started': 'ToolStartedParams',
    'tool.finished': 'ToolFinishedParams',
    'change.proposed': 'ChangeProposedParams',
    'change.applied': 'ChangeAppliedParams',
    'analysis.result': 'AnalysisResultParams',
    usage: 'UsageParams',
    error: 'ErrorParams',
  } as const

  it('covers every companion notification', () => {
    expect(sorted(Object.keys(companionNotificationTypes))).toEqual(
      sorted(Object.keys(companionNotificationDecoders)),
    )
  })

  it.each(Object.entries(companionNotificationTypes))('%s fields match', (method, name) => {
    expect(sorted(structFields(messages, name))).toEqual(
      keysOf(sampleCompanionNotifications[method as keyof typeof companionNotificationTypes]),
    )
  })

  it('nested rows match', () => {
    const row = sampleCompanionNotifications['change.proposed'].rows[0]
    expect(row).toBeDefined()
    expect(sorted(structFields(messages, 'ChangeRow'))).toEqual(keysOf(row ?? {}))
    const failedRow = Object.fromEntries(
      structFields(messages, 'FailedRow').map((field) => [field, 'x']),
    )
    const applied = { ...sampleCompanionNotifications['change.applied'], failed: [failedRow] }
    expect(companionNotificationDecoders['change.applied'](applied, 'params').ok).toBe(true)
  })

  it('mirrors the protocol version and error codes', () => {
    expect(messages).toMatch(new RegExp(`static let version = ${protocolVersion}\\b`))
    const codec = swift('Core/RpcCodec.swift')
    Object.entries(rpcErrorCodes).forEach(([name, code]) =>
      expect(codec).toMatch(new RegExp(`static let ${name} = ${code}\\b`)),
    )
  })

  it('ships XCTest vectors identical to the TypeScript fixtures', () => {
    const vectors: unknown = JSON.parse(read('Tests/Vectors/rpc-vectors.json'))
    expect(vectors).toEqual({
      protocolVersion,
      requests: Object.fromEntries(
        Object.keys(sampleParams).map((method) => {
          const key = method as keyof typeof sampleParams
          return [method, { params: sampleParams[key], result: sampleResults[key] }]
        }),
      ),
      pluginNotifications: samplePluginNotifications,
      companionNotifications: sampleCompanionNotifications,
      errorCodes: rpcErrorCodes,
    })
  })
})

describe('web view bridge', () => {
  const bridge = swift('Core/BridgeMessages.swift')
  const js = read('Web/app.js')

  const stringList = (source: string, name: string): readonly string[] => {
    const body = new RegExp(`static let ${name} = \\[([\\s\\S]*?)\\]`).exec(source)?.[1] ?? ''
    return Array.from(body.matchAll(/"([^"]+)"/g), (match) => match[1] ?? '')
  }

  const objectKeys = (name: string): readonly string[] => {
    const body = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\}`).exec(js)?.[1] ?? ''
    return Array.from(
      body.matchAll(/^ {2}(?:'([^']+)'|(\w+)):/gm),
      (match) => match[1] ?? match[2] ?? '',
    )
  }

  it('posts only commands the Swift bridge decodes', () => {
    const posted = new Set(
      Array.from(js.matchAll(/post\(\{ type: '([^']+)'/g), (match) => match[1] ?? ''),
    )
    expect(sorted([...posted])).toEqual(sorted(stringList(bridge, 'typeNames').slice(0, 9)))
  })

  it('handles every event type the Swift bridge sends', () => {
    const uiEvent =
      /enum UiEvent[\s\S]*?static let typeNames = \[([^\]]*)\]/.exec(bridge)?.[1] ?? ''
    const eventTypes = Array.from(uiEvent.matchAll(/"([^"]+)"/g), (match) => match[1] ?? '')
    expect(sorted(objectKeys('eventHandlers'))).toEqual(sorted(eventTypes))
  })

  it('renders every companion notification', () => {
    expect(sorted(objectKeys('notificationHandlers'))).toEqual(
      sorted(Object.keys(companionNotificationDecoders)),
    )
  })

  it('handles the response to every request the UI makes, and only those', () => {
    const posted = Array.from(js.matchAll(/post\(\{ type: '([^']+)'/g), (match) => match[1] ?? '')
    const uiRequests = [...new Set(posted)].filter((type) => Object.hasOwn(requestDecoders, type))
    expect(uiRequests).not.toContain('session.hello')
    expect(sorted(objectKeys('responseHandlers'))).toEqual(sorted(uiRequests))
  })
})

describe('plugin/README.md', () => {
  const readme = read('README.md')
  const checklist = readFileSync(join(root, 'docs/research/mac-checklist.md'), 'utf8')

  it('marks the scaffold as unverified and explains how to build it', () => {
    expect(readme).toMatch(/UNVERIFIED/)
    expect(readme).toContain('brew install xcodegen')
    expect(readme).toContain('xcodegen generate')
    expect(readme).toContain('xcodebuild')
  })

  it('maps assumptions only to MAC checks that exist', () => {
    const ids = new Set(Array.from(readme.matchAll(/MAC-\d{2}/g), (match) => match[0]))
    expect(ids.size).toBeGreaterThan(5)
    ids.forEach((id) => expect(checklist, id).toMatch(new RegExp(`^### ${id} `, 'm')))
  })
})
