/**
 * Model 3 — generate many title candidates with Ollama, score with Model 2, return top 5.
 */
import { extractStringArrayFromLlm } from './parseLlmStringArray.js'
import {
  buildTitleTrendNlpAnalysis,
  titleStructureNlpHints,
} from './enrichContext.js'
import { loadArtifact, scoreTitle } from './scoreTitle.js'
import { fetchTranscriptContentSummary } from './transcriptSummaryOllama.js'
import { TITLE_FORMAT_LLM_BLOCK } from './titleFormatPromptBlock.js'

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(
  /\/$/,
  '',
)
/** Light model for title candidates (not OLLAMA_MODEL / deepseek — too slow). */
const OLLAMA_RECOMMEND_MODEL =
  process.env.OLLAMA_RECOMMEND_MODEL ||
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

export function parseManyTitlesFromLlm(content, max = 40) {
  return extractStringArrayFromLlm(content, max).filter((s) => s.length > 2)
}

function dedupeTitles(titles) {
  const seen = new Set()
  const out = []
  for (const t of titles) {
    const k = String(t).trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(String(t).trim())
  }
  return out
}

function heuristicFallbackTitles(transcript, limit = 12) {
  const words = String(transcript)
    .toLowerCase()
    .match(/\b[a-z]{4,}\b/g)
  if (!words?.length) return []
  const uniq = [...new Set(words)].slice(0, 12)
  const out = []
  for (const w of uniq) {
    if (out.length >= limit) break
    out.push(`How to ${w} — complete guide`)
    if (out.length >= limit) break
    out.push(`Top ${w} tips you need to know`)
    if (out.length >= limit) break
    out.push(`Why ${w} matters (explained)`)
  }
  return out.slice(0, limit)
}

async function chatOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_RECOMMEND_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: {
        temperature: 0.4,
        num_predict: 420,
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
 * @param {{ transcript: string, categoryId: number, categoryLabel?: string, tags?: string[], region?: string, summary?: string }} opts
 */
export async function recommendTitlesPipeline(opts) {
  const transcript = String(opts.transcript || '').trim()
  let summary = String(opts.summary || '').trim()
  const categoryId = Number(opts.categoryId)
  const categoryLabel =
    typeof opts.categoryLabel === 'string' && opts.categoryLabel.trim()
      ? opts.categoryLabel.trim()
      : `category ${categoryId}`
  const tags = Array.isArray(opts.tags) ? opts.tags.map(String) : []
  const region = typeof opts.region === 'string' ? opts.region : undefined

  if (!transcript || transcript.length < 20) {
    throw new Error('transcript must be a string with at least 20 characters')
  }
  if (Number.isNaN(categoryId)) {
    throw new Error('categoryId is required')
  }

  if (summary.length < 30) {
    summary = (await fetchTranscriptContentSummary(transcript)).trim()
  }
  if (summary.length < 30) {
    throw new Error(
      'Could not build a content summary for titles — add an AI content summary on Input or ensure Ollama can summarize the transcript.',
    )
  }

  const artifact = loadArtifact()
  const bucket = getBucket(artifact, categoryId, region)
  const sampleTitles = Array.isArray(bucket?.sampleTitles)
    ? bucket.sampleTitles
    : []

  const patternExamples = [
    'How to …',
    'Top N …',
    'Why … fails / works',
    'I … (story)',
    'Beginner guide to …',
    '… explained',
    'Watch this before …',
  ].join(', ')

  const examplesBlock =
    sampleTitles.length > 0
      ? sampleTitles
          .slice(0, 10)
          .map((t, i) => `${i + 1}. ${t}`)
          .join('\n')
      : '(No stored examples — infer structure only from generic patterns below.)'

  const trendCtx =
    typeof bucket?.llmTrendContext === 'string' && bucket.llmTrendContext.trim()
      ? bucket.llmTrendContext.trim()
      : ''

  const trendNlp = buildTitleTrendNlpAnalysis({
    transcript,
    summary,
    tags,
    categoryId,
    categoryLabel,
  })

  const structureHints = titleStructureNlpHints(transcript)

  const prompt = `You are a YouTube title strategist.

PRIMARY SOURCE — CONTENT SUMMARY (what this video is actually about; every title must reflect THIS — topics, stakes, entities, outcome):
---
${summary.slice(0, 4000)}
---

Video category: "${categoryLabel}" (YouTube category_id ${categoryId}).
Viewer tags: ${tags.length ? tags.join(', ') : '(none)'}

STRUCTURE ANALYSIS (NLP on transcript + summary + category — use only to choose hook *types* and emphasis; do not paste token lists into titles):
---
${trendNlp}
---

Transcript-only structure hints (pattern types, not wording to copy):
${structureHints}

DATASET — STRUCTURE ONLY (successful title *shapes* in this niche from training data):
- Read the trend block and example titles below ONLY to infer length, punctuation habits, hook archetypes (how-to, list, question, story, vs., stakes).
- Do NOT copy phrases, rare words, or topic-specific wording from the dataset. Do NOT "match vocabulary" from examples.
- All topical wording must come from the CONTENT SUMMARY (and transcript for proper nouns if needed).

Dataset trend narrative (structural signals — paraphrase patterns, never lift phrases):
${trendCtx || '(No extra narrative — use category + examples below for structure only.)'}

Example titles from dataset (STRUCTURE REFERENCE ONLY — do not reuse their subjects or catchy phrases; invent new wording from the summary):
${examplesBlock}

Generic structural patterns to mix: ${patternExamples}

${TITLE_FORMAT_LLM_BLOCK}

Transcript excerpt (fact-check / proper nouns only — if summary and transcript disagree on a fact, prefer the summary):
---
${transcript.slice(0, 8000)}
---

Generate exactly 12–15 distinct English video titles that:
1. Describe the real content from the CONTENT SUMMARY (not generic dataset topics).
2. Cover several of the TITLE FORMAT archetypes above (vary patterns across titles).
3. Each title must be at most 10 words (count words; shorter is fine).
4. Borrow only *structure* from dataset examples and trend blocks (hook type, length, punctuation style).
5. Stay concise and compelling.

Respond with ONLY a JSON array of strings: no markdown, no property names, no "title:" prefix — just the array. Example: ["Title one", "Title two"]`

  let content
  try {
    content = await chatOllama(prompt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Ollama unreachable or failed (${msg}). Start Ollama and: ollama pull ${OLLAMA_RECOMMEND_MODEL}`,
    )
  }

  let candidates = parseManyTitlesFromLlm(content, 18)
  candidates = dedupeTitles(candidates)

  if (candidates.length < 8) {
    candidates = dedupeTitles([
      ...candidates,
      ...heuristicFallbackTitles(transcript, 12),
    ])
  }

  candidates = candidates.slice(0, 15)

  const scored = []
  for (const title of candidates) {
    const r = scoreTitle(artifact, {
      title,
      tags,
      categoryId,
      region,
    })
    scored.push({
      title,
      score: r.score,
      breakdown: r.breakdown,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 5)

  return {
    recommendations: top,
    candidateCount: candidates.length,
    datasetExamplesUsed: Math.min(sampleTitles.length, 10),
  }
}
