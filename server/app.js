/**
 * Express app for Whisper + Ollama. Used by Vite dev middleware and by `node index.js`.
 */

import { createReadStream } from 'fs'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { scoreTitleFromFile, loadArtifact, getArtifactPath } from './scoreTitle.js'
import { scoreTagConfidenceFromFile } from './scoreTitle.js'
import { recommendTitlesPipeline } from './recommendTitles.js'
import { recommendTagsPipeline } from './recommendTags.js'
import { recommendDescriptionsPipeline } from './recommendDescriptions.js'
import {
  buildTitleTrendNlpAnalysis,
  getLlmTrendContextForCategory,
  titleStructureNlpHints,
} from './enrichContext.js'
import {
  getModel4ArtifactPath,
  model4ArtifactOk,
  scoreThumbnailFromDataUrl,
} from './scoreThumbnail.js'
import {
  generateOneThumbnailTxt2Img,
  generateThumbnailsPipeline,
} from './generateThumbnailA1111.js'
import { fetchTranscriptContentSummary } from './transcriptSummaryOllama.js'
import {
  analyzeExcitementFromVideoFile,
  getModel56ScriptPath,
  model56ArtifactOk,
} from './analyzeExcitement.js'
import {
  recommendUploadDatesModel8,
  scoreUploadAtDatetime,
} from './recommendUploadDatesModel8.js'
import { loadYoutubeEnv } from './loadYoutubeEnv.js'
import { createYoutubeFromRefreshToken } from './lib/youtubeClient.js'

loadYoutubeEnv()

const execFileAsync = promisify(execFile)

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(
  /\/$/,
  '',
)
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'deepseek-r1:8b'
/** Fast model for transcript→titles+summary JSON. Default llama3.2:1b — do not use deepseek-r1 here (very slow “reasoning”). */
const OLLAMA_PIPELINE_MODEL = process.env.OLLAMA_PIPELINE_MODEL || 'llama3.2:1b'
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base'

const uploadFrame = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipfarm-up-'))
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.mp4'
      cb(null, safe)
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
})

/**
 * Run OpenAI Whisper CLI on a media file; returns plain transcript text.
 */
async function transcribeWithWhisper(mediaPath) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipfarm-whisper-'))
  try {
    await execFileAsync(
      'whisper',
      [
        mediaPath,
        '--language',
        'English',
        '--task',
        'transcribe',
        '--output_format',
        'txt',
        '--output_dir',
        outDir,
        '--model',
        WHISPER_MODEL,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    const names = await fs.readdir(outDir)
    const txtName = names.find((n) => n.endsWith('.txt'))
    if (!txtName) {
      throw new Error(
        'Whisper produced no .txt file. Is ffmpeg installed and whisper working?',
      )
    }
    const text = await fs.readFile(path.join(outDir, txtName), 'utf8')
    return text.trim()
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
  }
}

function parseTitlesFromLlm(content) {
  const raw = content.trim()
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean).slice(0, 10)
    }
  } catch {
    /* fall through */
  }
  return raw
    .split('\n')
    .map((line) =>
      line
        .replace(/^[\s]*[-*•\d.)]+\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 3)
    .slice(0, 10)
}

function parseTitlesOnlyPayload(content) {
  let raw = String(content || '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean).slice(0, 5)
    }
    if (parsed && Array.isArray(parsed.titles)) {
      return parsed.titles.map(String).filter(Boolean).slice(0, 5)
    }
  } catch {
    /* fall through */
  }
  return parseTitlesFromLlm(raw).slice(0, 5)
}

async function ollamaPipelineChat(prompt, options = {}) {
  let res
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_PIPELINE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: {
          temperature: options.temperature ?? 0.35,
          num_predict: options.num_predict ?? 256,
        },
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Ollama unreachable at ${OLLAMA_URL} (${msg}). Start Ollama and: ollama pull ${OLLAMA_PIPELINE_MODEL}`,
    )
  }
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Ollama error ${res.status}: ${errText}`)
  }
  const data = await res.json()
  const content = data?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Unexpected Ollama response shape')
  }
  return content
}

async function describeTranscriptDetailed(transcript) {
  return fetchTranscriptContentSummary(transcript)
}

async function enrichTitlesFromSummaryAndTrend(
  summary,
  trendContext,
  structureHints,
  trendNlpBlock,
  transcriptExcerpt,
) {
  const prompt = `You create YouTube video titles. Respond with ONLY valid JSON (no markdown) in exactly this shape:
{"titles":["title1","title2","title3","title4","title5"]}

CONTENT SUMMARY (primary source for topics, entities, stakes — titles must reflect THIS, not raw transcript wording):
---
${summary.slice(0, 3500)}
---

TRENDING STRUCTURE SIGNALS from dataset (match hook *patterns* and information density — do NOT copy specific words or phrases from this block):
---
${trendContext || '(No dataset block — use neutral YouTube-style hooks.)'}
---

AUTOMATIC STRUCTURE ANALYSIS — pattern *types* only (do not copy example words):
${structureHints}

MULTI-SIGNAL NLP (tags + summary + category + transcript stats — use to choose *title archetypes* and emphasis; ground proper nouns only if they appear in the summary; do not stuff raw keyword lists into titles):
---
${trendNlpBlock}
---

Transcript excerpt (fact-check only; if summary and excerpt conflict, prefer summary):
---
${transcriptExcerpt}
---

Rules:
- Exactly 5 distinct English titles.
- Encode structure (how-to, list, question, story, comparison, stakes) implied by the blocks above while describing real content from the summary.
- Do not paste phrases from the TRENDING block literally; paraphrase structure only.`

  const content = await ollamaPipelineChat(prompt, {
    temperature: 0.34,
    num_predict: 340,
  })
  return parseTitlesOnlyPayload(content)
}

/**
 * Sequential: detailed summary, then titles from summary + trend + structure hints.
 * @param {string} transcript
 * @param {{ categoryId?: number, region?: string }} [opts]
 */
async function enrichTranscriptCombined(transcript, opts = {}) {
  const summary = await describeTranscriptDetailed(transcript)
  const trendContext =
    opts.categoryId != null && !Number.isNaN(Number(opts.categoryId))
      ? getLlmTrendContextForCategory(Number(opts.categoryId), opts.region)
      : ''
  const structureHints = titleStructureNlpHints(transcript)
  const trendNlp = buildTitleTrendNlpAnalysis({
    transcript,
    summary,
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    categoryId: opts.categoryId,
    categoryLabel:
      typeof opts.categoryLabel === 'string' ? opts.categoryLabel : '',
  })
  const titles = await enrichTitlesFromSummaryAndTrend(
    summary,
    trendContext,
    structureHints,
    trendNlp,
    transcript.slice(0, 3500),
  )
  return { titles, summary }
}

async function describeTranscriptBriefPublic(transcript) {
  return describeTranscriptDetailed(transcript)
}

async function suggestTitlesWithOllama(transcript) {
  const prompt = `You are helping a creator title a YouTube-style video. Here is the full English transcript:\n\n---\n${transcript.slice(0, 12000)}\n---\n\nSuggest exactly 5 short, compelling video titles in English based only on this content. Respond with a JSON array of 5 strings only, no markdown or explanation. Example: ["Title one", "Title two"]`

  let res
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Ollama unreachable at ${OLLAMA_URL} (${msg}). Start the Ollama app, then: ollama pull ${OLLAMA_MODEL}`,
    )
  }

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Ollama error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const content = data?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Unexpected Ollama response shape')
  }
  return parseTitlesFromLlm(content)
}

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '48mb' }))

  app.post('/api/transcribe', upload.single('video'), async (req, res) => {
    if (!req.file?.path) {
      return res.status(400).json({ error: 'Missing file field "video"' })
    }
    const uploadDir = path.dirname(req.file.path)
    try {
      const transcript = await transcribeWithWhisper(req.file.path)
      return res.json({ transcript })
    } catch (err) {
      console.error(err)
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint: 'Install Whisper (openai-whisper) and ffmpeg; ensure `whisper` is on PATH.',
      })
    } finally {
      await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  app.post('/api/enrich-transcript', async (req, res) => {
    const transcript = req.body?.transcript
    const categoryId = req.body?.categoryId
    const region = req.body?.region
    const categoryLabel = req.body?.categoryLabel
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(String) : []
    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({
        error:
          'JSON body must include { transcript: string }; optional categoryId, region, categoryLabel, tags[]',
      })
    }
    try {
      const { titles, summary } = await enrichTranscriptCombined(transcript, {
        categoryId:
          categoryId != null && !Number.isNaN(Number(categoryId))
            ? Number(categoryId)
            : undefined,
        region: typeof region === 'string' ? region : undefined,
        categoryLabel:
          typeof categoryLabel === 'string' ? categoryLabel : undefined,
        tags,
      })
      return res.json({ titles, summary })
    } catch (err) {
      console.error(err)
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint: `Pipeline uses OLLAMA_PIPELINE_MODEL (${OLLAMA_PIPELINE_MODEL}). Try: ollama pull ${OLLAMA_PIPELINE_MODEL}`,
      })
    }
  })

  app.post('/api/transcript-description', async (req, res) => {
    const transcript = req.body?.transcript
    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({
        error: 'JSON body must include { transcript: string }',
      })
    }
    try {
      const description = await describeTranscriptBriefPublic(transcript)
      return res.json({ description })
    } catch (err) {
      console.error(err)
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint: `Uses OLLAMA_PIPELINE_MODEL (${OLLAMA_PIPELINE_MODEL}). Try: ollama pull ${OLLAMA_PIPELINE_MODEL}`,
      })
    }
  })

  app.post('/api/suggest-titles', async (req, res) => {
    const transcript = req.body?.transcript
    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({
        error: 'JSON body must include { transcript: string }',
      })
    }
    try {
      const titles = await suggestTitlesWithOllama(transcript)
      return res.json({ titles })
    } catch (err) {
      console.error(err)
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint: 'Start Ollama and pull the model: ollama pull ' + OLLAMA_MODEL,
      })
    }
  })

  app.post('/api/pipeline', upload.single('video'), async (req, res) => {
    if (!req.file?.path) {
      return res.status(400).json({ error: 'Missing file field "video"' })
    }
    const uploadDir = path.dirname(req.file.path)
    try {
      const transcript = await transcribeWithWhisper(req.file.path)
      const categoryId = req.body?.categoryId
      const region = req.body?.region
      const categoryLabel = req.body?.categoryLabel
      let tags = req.body?.tags
      if (typeof tags === 'string') {
        try {
          const p = JSON.parse(tags)
          tags = Array.isArray(p) ? p : []
        } catch {
          tags = []
        }
      }
      if (!Array.isArray(tags)) tags = []
      const { titles, summary } = await enrichTranscriptCombined(transcript, {
        categoryId:
          categoryId != null && !Number.isNaN(Number(categoryId))
            ? Number(categoryId)
            : undefined,
        region: typeof region === 'string' ? region : undefined,
        categoryLabel:
          typeof categoryLabel === 'string' ? categoryLabel : undefined,
        tags: tags.map(String),
      })
      return res.json({ transcript, titles, summary })
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      return res.status(500).json({
        error: msg,
        hint:
          msg.includes('Ollama') || msg.includes('fetch')
            ? `Ensure Ollama is running (${OLLAMA_URL}). Pipeline model: ollama pull ${OLLAMA_PIPELINE_MODEL}`
            : undefined,
      })
    } finally {
      await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  app.post('/api/analyze-excitement', upload.single('video'), async (req, res) => {
    if (!req.file?.path) {
      return res.status(400).json({ error: 'Missing file field "video"' })
    }
    const uploadDir = path.dirname(req.file.path)
    try {
      const result = await analyzeExcitementFromVideoFile(req.file.path)
      return res.json({
        ...result,
        analyzedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      const hint =
        msg.includes('python') || msg.includes('ffmpeg') || msg.includes('ffprobe')
          ? 'Install Python 3, numpy (pip install -r models/model56-excitement/requirements.txt), and ffmpeg/ffprobe on PATH.'
          : undefined
      return res.status(500).json({ error: msg, hint })
    } finally {
      await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  app.post('/api/recommend-upload-dates-model8', (req, res) => {
    try {
      const body = req.body || {}
      const segments = Array.isArray(body.segments) ? body.segments : null
      if (!segments || segments.length === 0) {
        return res.status(400).json({ error: 'JSON body must include segments (non-empty array)' })
      }
      const result = recommendUploadDatesModel8({
        segments,
        durationSec: body.durationSec,
        trendingRegion: body.trendingRegion,
        youtubeCategoryId: body.youtubeCategoryId,
        titleCharLen: body.titleCharLen,
        descriptionCharLen: body.descriptionCharLen,
        tagCount: body.tagCount,
      })
      return res.json(result)
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      return res.status(500).json({ error: msg })
    }
  })

  app.post('/api/model8-score-at-datetime', (req, res) => {
    try {
      const body = req.body || {}
      if (!body.atIso || typeof body.atIso !== 'string') {
        return res.status(400).json({ error: 'JSON body must include atIso (ISO datetime string)' })
      }
      const result = scoreUploadAtDatetime({
        atIso: body.atIso,
        trendingRegion: body.trendingRegion,
        youtubeCategoryId: body.youtubeCategoryId,
        titleCharLen: body.titleCharLen,
        descriptionCharLen: body.descriptionCharLen,
        tagCount: body.tagCount,
        engagement: body.engagement,
      })
      return res.json(result)
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      return res.status(500).json({ error: msg })
    }
  })

  app.get('/api/health', (_req, res) => {
    let model2 = false
    try {
      loadArtifact()
      model2 = true
    } catch {
      model2 = false
    }
    res.json({
      ok: true,
      ollamaModel: OLLAMA_MODEL,
      ollamaPipelineModel: OLLAMA_PIPELINE_MODEL,
      ollamaRecommendModel:
        process.env.OLLAMA_RECOMMEND_MODEL || OLLAMA_PIPELINE_MODEL,
      ollamaTagModel:
        process.env.OLLAMA_TAG_MODEL || OLLAMA_PIPELINE_MODEL,
      whisperModel: WHISPER_MODEL,
      model2Artifact: model2,
      model2Path: getArtifactPath(),
      model4Artifact: model4ArtifactOk(),
      model4Path: getModel4ArtifactPath(),
      a1111Configured: Boolean(process.env.A1111_BASE_URL),
      model56Artifact: model56ArtifactOk(),
      model56Path: getModel56ScriptPath(),
    })
  })

  app.post('/api/recommend-titles', async (req, res) => {
    try {
      const body = req.body || {}
      const transcript = body.transcript
      const categoryId = body.categoryId
      const categoryLabel =
        typeof body.categoryLabel === 'string' ? body.categoryLabel : undefined
      const tags = Array.isArray(body.tags) ? body.tags : []
      const region = typeof body.region === 'string' ? body.region : undefined
      const summary =
        typeof body.summary === 'string' ? body.summary : undefined
      if (typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({
          error: 'JSON body must include transcript (string, min ~20 chars)',
        })
      }
      if (categoryId == null || Number.isNaN(Number(categoryId))) {
        return res.status(400).json({ error: 'categoryId is required' })
      }
      const result = await recommendTitlesPipeline({
        transcript,
        categoryId: Number(categoryId),
        categoryLabel,
        tags,
        region,
        summary,
      })
      return res.json(result)
    } catch (err) {
      console.error(err)
      const e = err
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
        return res.status(503).json({
          error: 'Model 2 artifact not found',
          hint: `Run train.py --fixture (see models/model2-title-confidence/README.md). Expected: ${getArtifactPath()}`,
        })
      }
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint:
          err instanceof Error && err.message.includes('Ollama')
            ? `Ensure Ollama is running (${OLLAMA_URL}). Title picks use OLLAMA_RECOMMEND_MODEL / OLLAMA_PIPELINE_MODEL (e.g. ollama pull llama3.2:1b)`
            : undefined,
      })
    }
  })

  app.post('/api/recommend-descriptions', async (req, res) => {
    try {
      const body = req.body || {}
      const transcript = body.transcript
      const summary = body.summary
      const categoryId = body.categoryId
      const categoryLabel =
        typeof body.categoryLabel === 'string' ? body.categoryLabel : undefined
      const tags = Array.isArray(body.tags) ? body.tags : []
      const region = typeof body.region === 'string' ? body.region : undefined
      if (typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({
          error: 'JSON body must include transcript (string, min ~20 chars)',
        })
      }
      if (categoryId == null || Number.isNaN(Number(categoryId))) {
        return res.status(400).json({ error: 'categoryId is required' })
      }
      const result = await recommendDescriptionsPipeline({
        transcript,
        summary: typeof summary === 'string' ? summary : '',
        categoryId: Number(categoryId),
        categoryLabel,
        tags,
        region,
      })
      return res.json(result)
    } catch (err) {
      console.error(err)
      const e = err
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
        return res.status(503).json({
          error: 'Model 2 artifact not found',
          hint: `Run train.py --fixture (see models/model2-title-confidence/README.md). Expected: ${getArtifactPath()}`,
        })
      }
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint:
          err instanceof Error && err.message.includes('Ollama')
            ? `Ensure Ollama is running (${OLLAMA_URL}). Descriptions use OLLAMA_RECOMMEND_MODEL / OLLAMA_PIPELINE_MODEL`
            : undefined,
      })
    }
  })

  app.post('/api/recommend-tags', async (req, res) => {
    try {
      const body = req.body || {}
      const transcript = body.transcript
      const categoryId = body.categoryId
      const categoryLabel =
        typeof body.categoryLabel === 'string' ? body.categoryLabel : undefined
      const tags = Array.isArray(body.tags) ? body.tags : []
      const region = typeof body.region === 'string' ? body.region : undefined
      if (typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({
          error: 'JSON body must include transcript (string, min ~20 chars)',
        })
      }
      if (categoryId == null || Number.isNaN(Number(categoryId))) {
        return res.status(400).json({ error: 'categoryId is required' })
      }
      const result = await recommendTagsPipeline({
        transcript,
        categoryId: Number(categoryId),
        categoryLabel,
        tags,
        region,
      })
      return res.json(result)
    } catch (err) {
      console.error(err)
      const e = err
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
        return res.status(503).json({
          error: 'Model 2 artifact not found',
          hint: `Run train.py --fixture (see models/model2-title-confidence/README.md). Expected: ${getArtifactPath()}`,
        })
      }
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint:
          err instanceof Error && err.message.includes('Ollama')
            ? `Ensure Ollama is running (${OLLAMA_URL}). Tags use OLLAMA_TAG_MODEL / OLLAMA_PIPELINE_MODEL (e.g. ollama pull llama3.2:1b)`
            : undefined,
      })
    }
  })

  app.post('/api/score-title', (req, res) => {
    try {
      const { title, tags, categoryId, region } = req.body || {}
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title is required' })
      }
      if (categoryId == null || Number.isNaN(Number(categoryId))) {
        return res.status(400).json({ error: 'categoryId is required' })
      }
      const result = scoreTitleFromFile({
        title,
        tags: Array.isArray(tags) ? tags : [],
        categoryId: Number(categoryId),
        region: typeof region === 'string' ? region : undefined,
      })
      return res.json(result)
    } catch (e) {
      const err = e
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return res.status(503).json({
          error: 'Model 2 artifact not found',
          hint: `Run: python3 models/model2-title-confidence/scripts/train.py --fixture ... (see models/model2-title-confidence/README.md). Expected: ${getArtifactPath()}`,
        })
      }
      console.error(e)
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.post('/api/score-thumbnail', async (req, res) => {
    try {
      const raw = req.body?.imageBase64 ?? req.body?.thumbnailDataUrl
      if (typeof raw !== 'string' || !raw.trim()) {
        return res.status(400).json({
          error:
            'JSON body must include imageBase64 or thumbnailDataUrl (data URL or raw base64)',
        })
      }
      if (!model4ArtifactOk()) {
        return res.status(503).json({
          error: 'Model 4 artifact not found',
          hint: `Run: python3 models/model4-thumbnail/scripts/train.py --init-default (or --data-root with Kaggle extract). Expected: ${getModel4ArtifactPath()}`,
        })
      }
      const result = await scoreThumbnailFromDataUrl(raw.trim())
      return res.json(result)
    } catch (err) {
      console.error(err)
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint: 'Ensure Python deps: pip install -r models/model4-thumbnail/requirements.txt',
      })
    }
  })

  app.post('/api/generate-thumbnails', uploadFrame.single('frame'), async (req, res) => {
    try {
      if (!model4ArtifactOk()) {
        return res.status(503).json({
          error: 'Model 4 artifact not found',
          hint: `Run: python3 models/model4-thumbnail/scripts/train.py --init-default. Expected: ${getModel4ArtifactPath()}`,
        })
      }
      const title = typeof req.body.title === 'string' ? req.body.title : ''
      const summary = typeof req.body.summary === 'string' ? req.body.summary : ''
      let tags = []
      const rawTags = req.body.tags
      if (typeof rawTags === 'string' && rawTags.trim()) {
        try {
          const p = JSON.parse(rawTags)
          tags = Array.isArray(p) ? p.map(String) : []
        } catch {
          tags = rawTags.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)
        }
      }
      const nRaw = parseInt(String(req.body.n ?? '1'), 10)
      const count = Math.min(5, Math.max(1, Number.isFinite(nRaw) ? nRaw : 1))
      const stream =
        req.body.stream === '1' ||
        req.body.stream === 'true' ||
        req.body.stream === true

      if (stream) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('X-Accel-Buffering', 'no')
        for (let i = 0; i < count; i++) {
          const result = await generateOneThumbnailTxt2Img({ title, summary, tags })
          res.write(`${JSON.stringify({ index: i, result })}\n`)
        }
        res.end()
        return
      }

      const { results } = await generateThumbnailsPipeline({
        title,
        summary,
        tags,
        count,
      })
      return res.json({ results })
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      const unreachable =
        msg.includes('Cannot reach AUTOMATIC1111') ||
        msg.includes('fetch failed') ||
        msg.includes('ECONNREFUSED')
      return res.status(unreachable ? 503 : 500).json({
        error: msg,
        hint: unreachable
          ? 'Start AUTOMATIC1111 with --api (default http://127.0.0.1:7860). Set A1111_BASE_URL if it runs elsewhere.'
          : undefined,
      })
    }
  })

  app.post('/api/score-tag', (req, res) => {
    try {
      const { tag, transcript, tags, categoryId, region } = req.body || {}
      if (typeof tag !== 'string' || !tag.trim()) {
        return res.status(400).json({ error: 'tag is required' })
      }
      if (typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({ error: 'transcript is required' })
      }
      if (categoryId == null || Number.isNaN(Number(categoryId))) {
        return res.status(400).json({ error: 'categoryId is required' })
      }
      const result = scoreTagConfidenceFromFile({
        tag,
        transcript,
        tags: Array.isArray(tags) ? tags : [],
        categoryId: Number(categoryId),
        region: typeof region === 'string' ? region : undefined,
      })
      return res.json(result)
    } catch (e) {
      const err = e
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return res.status(503).json({
          error: 'Model 2 artifact not found',
          hint: `Expected: ${getArtifactPath()}`,
        })
      }
      console.error(e)
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  app.post(
    '/api/youtube/schedule-upload',
    upload.fields([
      { name: 'video', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
    async (req, res) => {
      let thumbPath
      let videoPathForUpload = null
      let trimmedPath = null
      try {
        const files = req.files
        const vid = files?.video?.[0]
        if (!vid?.path) {
          return res.status(400).json({ error: 'Missing video file (field: video)' })
        }
        let meta = {}
        try {
          meta = JSON.parse(req.body?.metadata || '{}')
        } catch {
          return res.status(400).json({ error: 'Invalid metadata JSON' })
        }
        const title = typeof meta.title === 'string' ? meta.title.trim() : ''
        if (!title) {
          await fs.unlink(vid.path).catch(() => {})
          return res.status(400).json({ error: 'metadata.title is required' })
        }
        const description =
          typeof meta.description === 'string' ? meta.description : ''
        const tags = Array.isArray(meta.tags)
          ? meta.tags.map(String).filter(Boolean)
          : []
        const publishAtIso =
          typeof meta.publishAtIso === 'string' ? meta.publishAtIso.trim() : ''
        if (!publishAtIso) {
          await fs.unlink(vid.path).catch(() => {})
          return res.status(400).json({ error: 'metadata.publishAtIso is required' })
        }
        const pub = new Date(publishAtIso)
        if (Number.isNaN(pub.getTime())) {
          await fs.unlink(vid.path).catch(() => {})
          return res.status(400).json({ error: 'Invalid publishAtIso' })
        }
        if (pub.getTime() <= Date.now()) {
          await fs.unlink(vid.path).catch(() => {})
          return res
            .status(400)
            .json({ error: 'Scheduled time must be in the future' })
        }
        const isShort = Boolean(meta.isShort)
        let categoryId = Number(meta.categoryId)
        if (!Number.isFinite(categoryId)) categoryId = 22
        if (isShort) categoryId = 42

        const tagList = [...tags]
        if (isShort && !tagList.some((t) => /shorts/i.test(t))) {
          tagList.push('Shorts')
        }
        let videoTitle = title
        if (isShort && !/#shorts/i.test(videoTitle)) {
          videoTitle = `${videoTitle} #Shorts`
        }

        const thumbFile = files?.thumbnail?.[0]
        const thumbDataUrl =
          typeof meta.thumbnailDataUrl === 'string'
            ? meta.thumbnailDataUrl.trim()
            : ''
        if (thumbDataUrl.startsWith('data:image')) {
          const m = /^data:image\/(\w+);base64,(.+)$/s.exec(thumbDataUrl)
          if (m) {
            const buf = Buffer.from(m[2], 'base64')
            const ext =
              m[1].toLowerCase() === 'png'
                ? 'png'
                : m[1].toLowerCase() === 'jpeg' || m[1].toLowerCase() === 'jpg'
                  ? 'jpg'
                  : 'png'
            thumbPath = path.join(
              os.tmpdir(),
              `clipfarm-yt-thumb-${Date.now()}.${ext}`,
            )
            await fs.writeFile(thumbPath, buf)
          }
        } else if (thumbFile?.path) {
          thumbPath = thumbFile.path
        }

        videoPathForUpload = vid.path
        const trimStart = Number(meta.trimStartSec)
        const trimEnd = Number(meta.trimEndSec)
        if (
          Number.isFinite(trimStart) &&
          Number.isFinite(trimEnd) &&
          trimEnd > trimStart + 0.05
        ) {
          trimmedPath = path.join(
            os.tmpdir(),
            `clipfarm-yt-trim-${Date.now()}.mp4`,
          )
          const duration = trimEnd - trimStart
          try {
            await execFileAsync(
              'ffmpeg',
              [
                '-y',
                '-ss',
                String(trimStart),
                '-i',
                vid.path,
                '-t',
                String(duration),
                '-c',
                'copy',
                '-movflags',
                '+faststart',
                trimmedPath,
              ],
              { maxBuffer: 80 * 1024 * 1024, timeout: 900000 },
            )
          } catch (ffErr) {
            await fs.unlink(vid.path).catch(() => {})
            if (trimmedPath) await fs.unlink(trimmedPath).catch(() => {})
            if (thumbPath && thumbPath !== thumbFile?.path) {
              await fs.unlink(thumbPath).catch(() => {})
            }
            return res.status(500).json({
              error:
                ffErr instanceof Error
                  ? `ffmpeg: ${ffErr.message}`
                  : 'Video trim failed (is ffmpeg installed?)',
            })
          }
          await fs.unlink(vid.path).catch(() => {})
          videoPathForUpload = trimmedPath
        }

        let youtube
        try {
          youtube = createYoutubeFromRefreshToken()
        } catch (e) {
          await fs.unlink(videoPathForUpload).catch(() => {})
          if (thumbPath && thumbPath !== thumbFile?.path) {
            await fs.unlink(thumbPath).catch(() => {})
          }
          return res.status(503).json({
            error:
              e instanceof Error
                ? e.message
                : 'YouTube credentials missing. Configure server/youtube.env',
          })
        }

        const status = {
          privacyStatus: 'private',
          selfDeclaredMadeForKids: false,
          publishAt: publishAtIso,
        }

        const insertRes = await youtube.videos.insert({
          part: ['snippet', 'status'],
          requestBody: {
            snippet: {
              title: videoTitle,
              description,
              tags: tagList.slice(0, 500),
              categoryId: String(categoryId),
            },
            status,
          },
          media: {
            body: createReadStream(videoPathForUpload),
          },
        })

        const videoId = insertRes.data.id
        await fs.unlink(videoPathForUpload).catch(() => {})

        if (thumbPath && videoId) {
          try {
            await youtube.thumbnails.set({
              videoId,
              media: {
                body: createReadStream(thumbPath),
              },
            })
          } catch (thumbErr) {
            console.error('youtube thumbnails.set:', thumbErr)
          }
        }
        if (thumbPath && thumbPath !== thumbFile?.path) {
          await fs.unlink(thumbPath).catch(() => {})
        }

        return res.json({
          videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        })
      } catch (err) {
        console.error(err)
        if (videoPathForUpload) {
          await fs.unlink(videoPathForUpload).catch(() => {})
        }
        return res.status(500).json({
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
  )

  return app
}
