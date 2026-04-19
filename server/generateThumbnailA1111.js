/**
 * AUTOMATIC1111 WebUI txt2img (from scratch) + Model 4 scoring per image.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { scoreThumbnailFromDataUrl } from './scoreThumbnail.js'
import { normalizeA1111BaseUrl, postJsonToA1111 } from './a1111HttpClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
const STATS_PATH = path.join(
  REPO_ROOT,
  'models',
  'model4-thumbnail',
  'artifacts',
  'stats.json',
)

function getA1111BaseUrl() {
  return normalizeA1111BaseUrl(process.env.A1111_BASE_URL || 'http://127.0.0.1:7860')
}

function getTxt2ImgPath() {
  return process.env.A1111_TXT2IMG_PATH || '/sdapi/v1/txt2img'
}

function getTxt2ImgRequestUrl() {
  const base = getA1111BaseUrl()
  const p = getTxt2ImgPath()
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  const pathPart = p.startsWith('/') ? p : `/${p}`
  return `${base}${pathPart}`
}

function loadDatasetTextHint() {
  try {
    const raw = fs.readFileSync(STATS_PATH, 'utf8')
    const j = JSON.parse(raw)
    const p = j.text_proxy_percentiles || {}
    const p25 = p.p25 ?? 0.08
    const p50 = p.p50 ?? 0.15
    const p75 = p.p75 ?? 0.28
    return `Dataset text bands: typical on-image text ~${(p50 * 100).toFixed(0)}% of frame (p25–p75 ${(p25 * 100).toFixed(0)}–${(p75 * 100).toFixed(0)}%).`
  } catch {
    return 'Reserve a large readable text band like successful YouTube thumbnails.'
  }
}

/** Pull short topical tokens to anchor the image (reduces unrelated / generic generations). */
function topicAnchorsFromContext(title, summary, tags) {
  const tagList = Array.isArray(tags) ? tags.map((x) => String(x).trim()).filter(Boolean) : []
  const blob = `${String(title || '')} ${String(summary || '')}`.toLowerCase()
  const words = blob.match(/\b[a-z][a-z'-]{2,}\b/g) || []
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'from',
    'have',
    'has',
    'was',
    'were',
    'are',
    'you',
    'your',
    'how',
    'what',
    'when',
    'why',
    'video',
    'about',
    'into',
    'just',
    'like',
    'they',
    'their',
  ])
  const freq = new Map()
  for (const w of words) {
    if (stop.has(w)) continue
    freq.set(w, (freq.get(w) || 0) + 1)
  }
  const fromSummary = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)
  const merged = [...new Set([...tagList.slice(0, 10), ...fromSummary])].slice(0, 12)
  return merged.join(', ')
}

/**
 * txt2img: one unified sketch thumbnail — single scene, one big text block (not collage / grid).
 * @param {{ title?: string, summary?: string, tags?: string[] }} ctx
 */
function buildTxt2ImgPrompt(ctx) {
  const title = ctx?.title
  const summary = ctx?.summary
  const tags = ctx?.tags
  const t = String(title || '').trim().slice(0, 180)
  const s = String(summary || '').trim().slice(0, 520)
  const anchors = topicAnchorsFromContext(t, s, tags)
  const topicLine = t
    ? `REQUIRED on-image headline text (spell exactly, large letters): ${t}`
    : ''
  const summaryLine = s
    ? `This video is ONLY about: ${s.slice(0, 420)}`
    : ''
  const anchorLine = anchors
    ? `Visual must reflect these topics and nothing else: ${anchors}.`
    : ''
  const datasetLine = loadDatasetTextHint()

  return [
    'Topic-locked YouTube thumbnail: illustrate ONLY the subject described below — no unrelated celebrities, no generic stock scenes, no random objects not mentioned in the summary.',
    'One single full-bleed YouTube thumbnail, 16:9, exactly one picture — not a grid, not a collage, not multiple photos, not a storyboard or filmstrip.',
    'Sketch and ink illustration style, bold outlines, selective flat color, not a photograph, not 3D render.',
    'Exactly ONE large headline text block covering about 40% of the frame; spell the title phrase clearly; one text region only — no stickers, no subtitles, no UI chrome.',
    'Place that headline in the lower third or center band; high contrast lettering; no tiny or scattered text anywhere else.',
    datasetLine,
    anchorLine,
    topicLine,
    summaryLine,
    'One clear focal subject or metaphor that matches the summary; cohesive composition; no split screen, no comic panels.',
  ]
    .filter(Boolean)
    .join(' ')
}

const NEGATIVE_PROMPT = [
  'collage',
  'photo collage',
  'image grid',
  'tiled',
  'mosaic',
  'split screen',
  'multiple panels',
  'comic strip layout',
  'storyboard',
  'filmstrip',
  'sequential panels',
  'contact sheet',
  'many small pictures',
  'busy cluttered layout',
  'dozens of faces',
  'photorealistic',
  'realistic photo',
  'blurry',
  'lowres',
  'worst quality',
  'watermark',
  'tiny text',
  'microscopic text',
  'small captions everywhere',
  'illegible text',
  'muted',
  'empty frame',
  'boring',
  'duplicate',
  'nsfw',
  'wrong topic',
  'unrelated subject',
  'generic stock image',
  'random person',
].join(', ')

function txt2ImgBody(prompt) {
  return {
    prompt,
    negative_prompt: NEGATIVE_PROMPT,
    steps: Number(process.env.A1111_STEPS) || 28,
    cfg_scale: Number(process.env.A1111_CFG_SCALE) || 7.5,
    width: Number(process.env.A1111_WIDTH) || 1280,
    height: Number(process.env.A1111_HEIGHT) || 720,
    batch_size: 1,
    n_iter: 1,
    restore_faces: false,
  }
}

/**
 * One txt2img image, scored.
 * @param {{ title?: string, summary?: string, tags?: string[] }} opts
 */
export async function generateOneThumbnailTxt2Img(opts) {
  const url = getTxt2ImgRequestUrl()
  const prompt = buildTxt2ImgPrompt({
    title: opts.title,
    summary: opts.summary,
    tags: opts.tags,
  })
  const data = await postJsonToA1111(url, txt2ImgBody(prompt))
  const images = data.images
  if (!Array.isArray(images) || !images[0]) {
    throw new Error('A1111 txt2img returned no image')
  }
  const dataUrl = `data:image/png;base64,${images[0]}`
  let scored
  try {
    scored = await scoreThumbnailFromDataUrl(dataUrl)
  } catch (e) {
    return {
      dataUrl,
      score: 0,
      breakdown: undefined,
      scoreError: e instanceof Error ? e.message : String(e),
    }
  }
  return {
    dataUrl,
    score: typeof scored.score === 'number' ? scored.score : 0,
    breakdown: scored.breakdown,
  }
}

/**
 * @param {{ title?: string, summary?: string, tags?: string[], count?: number }} opts
 */
export async function generateThumbnailsPipeline(opts) {
  const count = Math.min(5, Math.max(1, Number(opts.count) || 1))
  const results = []
  for (let i = 0; i < count; i++) {
    const one = await generateOneThumbnailTxt2Img({
      title: opts.title,
      summary: opts.summary,
      tags: opts.tags,
    })
    results.push(one)
  }
  return { results }
}
