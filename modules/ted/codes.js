import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE = new Map()

export function resolveCode(codelistId, code) {
  if (!codelistId || !code) return null
  if (!CACHE.has(codelistId)) {
    const filePath = join(__dirname, `data/codelists/${codelistId}.json`)
    const data = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf-8')) : {}
    CACHE.set(codelistId, data)
  }
  const entry = CACHE.get(codelistId)[code]
  if (!entry) return null
  return entry.lit || entry.eng || Object.values(entry)[0] || null
}
