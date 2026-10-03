export type YamlValue = string | readonly YamlValue[] | { readonly [key: string]: YamlValue }

type Line = { readonly indent: number; readonly text: string; readonly number: number }

const unsupported = /^(?:[[{&*!|>%@`]|---|\.\.\.)/

const toLines = (source: string): readonly Line[] =>
  source.split('\n').flatMap((raw, index) => {
    if (raw.includes('\t')) throw new Error(`line ${index + 1}: tabs are not supported`)
    const text = raw.trimEnd()
    if (text.trim() === '' || text.trim().startsWith('#')) return []
    return [{ indent: text.length - text.trimStart().length, text: text.trim(), number: index + 1 }]
  })

const scalar = (raw: string, line: number): string => {
  const text = raw.trim()
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1).replaceAll("''", "'")
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1)
  if (unsupported.test(text)) throw new Error(`line ${line}: unsupported YAML syntax "${text}"`)
  if (text.includes(' #')) throw new Error(`line ${line}: trailing comments are not supported`)
  return text
}

const mapEntry = /^([^\s:'"][^:]*?):(?:\s+(.*))?$/

export const parseYamlSubset = (source: string): YamlValue => {
  const lines = toLines(source)

  const parseBlock = (start: number, indent: number): { value: YamlValue; next: number } =>
    lines[start]?.text.startsWith('- ') || lines[start]?.text === '-'
      ? parseList(start, indent)
      : parseMap(start, indent, lines)

  const parseList = (start: number, indent: number): { value: YamlValue; next: number } => {
    const items: YamlValue[] = []
    let index = start
    while (index < lines.length) {
      const line = lines[index]
      if (line === undefined || line.indent !== indent || !line.text.startsWith('- ')) break
      const rest = line.text.slice(2).trim()
      if (mapEntry.test(rest)) {
        const virtual: Line = { indent: indent + 2, text: rest, number: line.number }
        const view = [...lines.slice(0, index), virtual, ...lines.slice(index + 1)]
        const parsed = parseMap(index, indent + 2, view)
        items.push(parsed.value)
        index = parsed.next
      } else {
        items.push(scalar(rest, line.number))
        index += 1
      }
    }
    return { value: items, next: index }
  }

  const parseMap = (
    start: number,
    indent: number,
    view: readonly Line[],
  ): { value: YamlValue; next: number } => {
    const entries: [string, YamlValue][] = []
    let index = start
    while (index < view.length) {
      const line = view[index]
      if (line === undefined || line.indent < indent) break
      if (line.indent > indent) throw new Error(`line ${line.number}: unexpected indentation`)
      const match = mapEntry.exec(line.text)
      if (match === null) throw new Error(`line ${line.number}: expected "key: value"`)
      const key = match[1] ?? ''
      if (entries.some(([existing]) => existing === key))
        throw new Error(`line ${line.number}: duplicate key "${key}"`)
      const inline = match[2]
      if (inline !== undefined && inline.trim() !== '') {
        entries.push([key, scalar(inline, line.number)])
        index += 1
        continue
      }
      const child = view[index + 1]
      if (child === undefined || child.indent <= indent)
        throw new Error(`line ${line.number}: "${key}" has no value`)
      const parsed = parseBlock(index + 1, child.indent)
      entries.push([key, parsed.value])
      index = parsed.next
    }
    return { value: Object.fromEntries(entries), next: index }
  }

  const first = lines[0]
  if (first === undefined) throw new Error('empty document')
  const parsed = parseBlock(0, first.indent)
  const leftover = lines[parsed.next]
  if (leftover !== undefined) throw new Error(`line ${leftover.number}: could not parse`)
  return parsed.value
}
