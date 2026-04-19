/**
 * Model 5/6 — excitement segmentation (Python analyze.py + ffmpeg).
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
const ANALYZE_SCRIPT = path.join(
  REPO_ROOT,
  'models',
  'model56-excitement',
  'scripts',
  'analyze.py',
)

export function getModel56ScriptPath() {
  return ANALYZE_SCRIPT
}

export function model56ArtifactOk() {
  try {
    fs.accessSync(ANALYZE_SCRIPT)
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} videoPath absolute path to video file
 * @returns {Promise<{
 *   durationSec: number,
 *   fullDurationSec: number,
 *   capped: boolean,
 *   segments: { start: number, end: number, engagement: string }[],
 *   windows: unknown[],
 *   meta: { windowSec: number, weights: Record<string, number> }
 * }>}
 */
export async function analyzeExcitementFromVideoFile(videoPath) {
  const { stdout, stderr } = await execFileAsync(
    'python3',
    [ANALYZE_SCRIPT, videoPath],
    {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600000,
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    },
  )
  let data
  try {
    data = JSON.parse(stdout.trim())
  } catch (e) {
    const hint = (stderr || '').toString().slice(0, 500)
    throw new Error(
      `Model 5/6: invalid JSON (${e instanceof Error ? e.message : String(e)}). ${hint}`,
    )
  }
  if (data.error) {
    throw new Error(String(data.error))
  }
  const dur = Number(data.durationSec)
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error('Model 5/6: invalid durationSec')
  }
  const segments = (data.segmentsSec || []).map((s) => ({
    start: s.startSec / dur,
    end: s.endSec / dur,
    engagement: s.engagement === 'high' ? 'high' : 'low',
  }))
  return {
    durationSec: dur,
    fullDurationSec: Number(data.fullDurationSec) || dur,
    capped: Boolean(data.capped),
    segments,
    windows: data.windows ?? [],
    meta: {
      windowSec: Number(data.windowSec) || 3,
      weights: {
        w1: 0.28,
        w2: 0.28,
        w3: 0.14,
        w4: 0.18,
        w5: 0.12,
        ...(data.weights && typeof data.weights === 'object' ? data.weights : {}),
      },
    },
  }
}
