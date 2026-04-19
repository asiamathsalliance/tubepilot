/**
 * Model 4 — thumbnail scorer (Python YOLO + CNN features vs dataset stats).
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import fsPromises from 'fs/promises'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
const SCORE_SCRIPT = path.join(
  REPO_ROOT,
  'models',
  'model4-thumbnail',
  'scripts',
  'score.py',
)
const ARTIFACT = path.join(
  REPO_ROOT,
  'models',
  'model4-thumbnail',
  'artifacts',
  'stats.json',
)

export function getModel4ArtifactPath() {
  return ARTIFACT
}

export function model4ArtifactOk() {
  try {
    fs.accessSync(ARTIFACT)
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} imagePath absolute path to PNG/JPG
 * @returns {Promise<Record<string, unknown>>}
 */
export async function scoreThumbnailFile(imagePath) {
  const { stdout } = await execFileAsync('python3', [SCORE_SCRIPT, imagePath], {
    maxBuffer: 25 * 1024 * 1024,
    timeout: 180000,
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })
  const text = stdout.trim()
  const lastBrace = text.lastIndexOf('}')
  const firstBrace = text.indexOf('{')
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`Model 4: no JSON in stdout: ${text.slice(0, 400)}`)
  }
  return JSON.parse(text.slice(firstBrace, lastBrace + 1))
}

const DATA_URL_RE = /^data:image\/[\w+.-]+;base64,/

/**
 * @param {string} dataUrlOrBase64
 */
export async function scoreThumbnailFromDataUrl(dataUrlOrBase64) {
  let b64 = String(dataUrlOrBase64 || '').trim()
  if (DATA_URL_RE.test(b64)) {
    b64 = b64.replace(DATA_URL_RE, '')
  }
  if (!b64) throw new Error('Empty image payload')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 32) throw new Error('Invalid base64 image')
  const tmp = path.join(
    os.tmpdir(),
    `clipfarm-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  )
  await fsPromises.writeFile(tmp, buf)
  try {
    return await scoreThumbnailFile(tmp)
  } finally {
    await fsPromises.rm(tmp, { force: true }).catch(() => {})
  }
}
