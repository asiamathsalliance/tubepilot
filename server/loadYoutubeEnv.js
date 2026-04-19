/**
 * Loads server/youtube.env into process.env (for Vite middleware & node index.js).
 * Does not override existing env vars.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function loadYoutubeEnv() {
  const envPath = path.join(__dirname, 'youtube.env')
  let raw
  try {
    raw = fs.readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key && val !== '' && process.env[key] === undefined) {
      process.env[key] = val
    }
  }
}
