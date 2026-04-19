/**
 * Tag recommendations — light Ollama generates ≤15 candidates, scored by Model 2 — Tag confidence, top 8.
 */
import { extractStringArrayFromLlm } from './parseLlmStringArray.js'
import { loadArtifact, scoreTagConfidence } from './scoreTitle.js'

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(
  /\/$/,
  '',
)
const OLLAMA_TAG_MODEL =
  process.env.OLLAMA_TAG_MODEL ||
  process.env.OLLAMA_PIPELINE_MODEL ||
  'llama3.2:1b'

function getBucket(artifact, categoryId, region) {
  const catKey = String(Number(categoryId))
  const regionPref = (region || 'GLOBAL').toUpperCase()
  let bucket =
    artifact.categories?.[catKey]?.regions?.[regionPref] ||
    artifact.categories?.[catKey]?.regions?.GLOBAL
  if (!bucket && artifact.categories?.[catKey]?.regions) {
    const regs = artifact.categories[catKey].regions
    bucket = regs[Object.keys(regs)[0]]
  }
  return bucket
}

/** YouTube-style tags: lowercase words / 2–3 word phrases only (no sentences). */
export function coerceShortTagPhrase(s) {
  let t = String(s ?? '')
    .trim()
    .toLowerCase()
  if (!t || t.startsWith('http')) return ''
  t = t.replace(/^#+/, '')
  t = t.split(/[.;!?]/)[0].trim()
  t = t.replace(/\s+/g, ' ')
  const words = t.split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const clipped = words.length > 4 ? words.slice(0, 3) : words
  t = clipped.join(' ')
  if (t.length > 40) t = t.slice(0, 40).trim()
  if (t.split(/\s+/).length === 1 && t.length > 22) t = t.slice(0, 22)
  return t
}

export function parseManyTagsFromLlm(content, max = 18) {
  return extractStringArrayFromLlm(content, max)
    .map(coerceShortTagPhrase)
    .filter((s) => s.length > 0 && s.length <= 42)
}

function dedupeTags(tags) {
  const seen = new Set()
  const out = []
  for (const t of tags) {
    const k = String(t).trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(String(t).trim())
  }
  return out
}

function heuristicFallbackTags(transcript, limit = 15) {
  const words = String(transcript)
    .toLowerCase()
    .match(/\b[a-z]{3,}\b/g)
  if (!words?.length) return []
  const freq = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w)
}

async function chatOllamaTag(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_TAG_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: {
        temperature: 0.35,
        num_predict: 320,
      },
    }),
  })
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

/**
 * @param {{ transcript: string, categoryId: number, categoryLabel?: string, tags?: string[], region?: string }} opts
 */
export async function recommendTagsPipeline(opts) {
  const transcript = String(opts.transcript || '').trim()
  const categoryId = Number(opts.categoryId)
  const categoryLabel =
    typeof opts.categoryLabel === 'string' && opts.categoryLabel.trim()
      ? opts.categoryLabel.trim()
      : `category ${categoryId}`
  const viewerTags = Array.isArray(opts.tags) ? opts.tags.map(String) : []
  const region = typeof opts.region === 'string' ? opts.region : undefined

  if (!transcript || transcript.length < 20) {
    throw new Error('transcript must be a string with at least 20 characters')
  }
  if (Number.isNaN(categoryId)) {
    throw new Error('categoryId is required')
  }

  const artifact = loadArtifact()
  const bucket = getBucket(artifact, categoryId, region)
  const topTags = Array.isArray(bucket?.topTags) ? bucket.topTags : []
  const topTagsBlock =
    topTags.length > 0
      ? topTags.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(No dataset tags for this bucket — infer from transcript + category.)'

  const trendCtx =
    typeof bucket?.llmTrendContext === 'string' && bucket.llmTrendContext.trim()
      ? bucket.llmTrendContext.trim()
      : ''

  const prompt = `YouTube SEO tags for one video. Tags must match the transcript content AND lean into dataset trend vocabulary for this category.

Category: "${categoryLabel}" (id ${categoryId}).
Existing viewer tags: ${viewerTags.length ? viewerTags.join(', ') : '(none)'}

Dataset trend signals (Kaggle trending-derived — prefer overlapping tokens when they fit the transcript):
${trendCtx || '(Use numbered tag list below only.)'}

Trending tags in this category from our dataset (prefer these WORDS when relevant, do not copy blindly):
${topTagsBlock}

Transcript (primary source of truth):
---
${transcript.slice(0, 8000)}
---

CRITICAL: Each tag must be a SINGLE WORD or a SHORT PHRASE of at most 3 words (e.g. "let's play" / "epic win"). NO full sentences, NO commas inside a tag, NO explanations, NO periods. Lowercase. Think YouTube tag box keywords only.

Return ONLY a JSON array of exactly 12–15 items.
Example: ["gaming", "fortnite", "tutorial", "epic win", "season 5", "tips tricks"]`

  let content
  try {
    content = await chatOllamaTag(prompt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Ollama unreachable or failed (${msg}). Start Ollama and: ollama pull ${OLLAMA_TAG_MODEL}`,
    )
  }

  let candidates = parseManyTagsFromLlm(content, 18)
  candidates = dedupeTags(candidates)

  if (candidates.length < 10) {
    candidates = dedupeTags([
      ...candidates,
      ...heuristicFallbackTags(transcript, 15),
    ])
  }

  candidates = candidates.slice(0, 15)

  const scored = []
  for (const tag of candidates) {
    const r = scoreTagConfidence(artifact, {
      tag,
      transcript,
      tags: viewerTags,
      categoryId,
      region,
    })
    scored.push({
      tag,
      score: r.score,
      breakdown: r.breakdown,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 8)

  return {
    recommendations: top,
    candidateCount: candidates.length,
    datasetTagsUsed: Math.min(topTags.length, 10),
  }
}
