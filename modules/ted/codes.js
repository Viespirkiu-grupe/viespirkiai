import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE = new Map()

function resolveTedCodelistPath(codelistId) {
  const runtimePath = join(process.cwd(), 'modules', 'ted', 'data', 'codelists', `${codelistId}.json`)
  if (existsSync(runtimePath)) return runtimePath

  const bundledPath = join(__dirname, 'data', 'codelists', `${codelistId}.json`)
  if (existsSync(bundledPath)) return bundledPath

  return null
}

export function resolveCode(codelistId, code) {
  if (!codelistId || !code) return null
  if (!CACHE.has(codelistId)) {
    const filePath = resolveTedCodelistPath(codelistId)
    const data = filePath ? JSON.parse(readFileSync(filePath, 'utf-8')) : {}
    CACHE.set(codelistId, data)
  }
  const entry = CACHE.get(codelistId)[code]
  if (!entry) return null
  return entry.lit || entry.eng || Object.values(entry)[0] || null
}
