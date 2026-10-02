import { stat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import {
  analyseFile,
  analyseStemFolder,
  compareToReference,
  type AnalysisError,
  type Result,
} from '../../dist/analysis/index.js'

const usage = `usage:
  node research/001-offline-analysis/analyse.ts <mix-file> [--reference <file>]
  node research/001-offline-analysis/analyse.ts <stem-folder>

Run \`npm run build\` first. Prints an AnalysisReport (or StemsReport) as JSON on stdout
and the wall-clock time on stderr.`

const unwrap = <T>(result: Result<T, AnalysisError>): T => {
  if (!result.ok) {
    console.error(JSON.stringify(result.error, null, 2))
    process.exit(1)
  }
  return result.value
}

const main = async (): Promise<void> => {
  const [target, flag, referencePath] = process.argv.slice(2)
  if (!target || (flag !== undefined && (flag !== '--reference' || !referencePath))) {
    console.error(usage)
    process.exit(2)
  }
  const started = performance.now()
  const isFolder = (await stat(target)).isDirectory()
  if (isFolder) {
    console.log(JSON.stringify(unwrap(await analyseStemFolder(target)), null, 2))
  } else {
    const mix = unwrap(await analyseFile(target))
    const output =
      referencePath === undefined
        ? mix
        : { mix, comparison: compareToReference(mix, unwrap(await analyseFile(referencePath))) }
    console.log(JSON.stringify(output, null, 2))
  }
  console.error(`analysed in ${((performance.now() - started) / 1000).toFixed(2)} s`)
}

await main()
