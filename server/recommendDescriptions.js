/**
 * Model 3 — description candidates (LLM + simple transcript-alignment score).
 */
import { loadArtifact } from './scoreTitle.js'
import { getLlmTrendContextForCategory } from './enrichContext.js'
import { fetchTranscriptContentSummary } from './transcriptSummaryOllama.js'

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(
  /\/$/,
  '',
)
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

function tokenizeForOverlap(s) {
  return String(s || '')
    .toLowerCase()
    .match(/\b[a-z]{3,}\b/g) || []
}

/** Prefer alignment to content summary (primary) + transcript overlap. */
function scoreDescriptionVsSummary(description, summary, transcript) {
  const dtoks = new Set(tokenizeForOverlap(description))
  const stoks = new Set(tokenizeForOverlap(summary))
  const ttoks = new Set(tokenizeForOverlap(transcript))
  if (dtoks.size === 0) return 28
  let hitS = 0
  for (const w of dtoks) if (stoks.has(w)) hitS++
  let hitT = 0
  for (const w of dtoks) if (ttoks.has(w)) hitT++
  const recallS = stoks.size > 0 ? hitS / stoks.size : 0
  const recallT = ttoks.size > 0 ? hitT / ttoks.size : 0
  const precision = hitS / dtoks.size
  const mix = 0.5 * recallS + 0.28 * recallT + 0.22 * precision
  return Math.round(Math.min(100, 34 + 66 * mix))
}

export function clampTwoSentences(s) {
  const t = String(s).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (parts.length <= 2) return t.slice(0, 420)
  return parts.slice(0, 2).join(' ').slice(0, 420)
}

function repairJsonCandidate(s) {
  let t = String(s)
  t = t.replace(/\u201c|\u201d|\u2018|\u2019/g, '"')
  t = t.replace(/,\s*]/g, ']')
  t = t.replace(/,\s*}/g, '}')
  return t
}

/**
 * Strict { "descriptions": string[] } from model output.
 */
export function parseDescriptionsJson(content) {
  let raw = String(content ?? '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model output')
  }
  let slice = raw.slice(start, end + 1)
  let obj
  try {
    obj = JSON.parse(slice)
  } catch {
    try {
      obj = JSON.parse(repairJsonCandidate(slice))
    } catch (e2) {
      const m = e2 instanceof Error ? e2.message : String(e2)
      throw new Error(`JSON parse failed: ${m}`)
    }
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.descriptions)) {
    throw new Error('JSON must be exactly: { "descriptions": string[] }')
  }
  const arr = obj.descriptions
    .map((s) => clampTwoSentences(String(s)))
    .filter((s) => s.length > 10)
  if (arr.length === 0) throw new Error('descriptions array was empty after parse')
  return arr.slice(0, 6)
}

/**
 * When JSON is invalid (e.g. unescaped quotes inside strings), scan the "descriptions" array
 * and pull quoted string elements. Less accurate than strict JSON but avoids total failure.
 */
function extractDescriptionsArrayStringsFromSlice(slice) {
  const re = /"descriptions"\s*:\s*\[/i
  const match = slice.match(re)
  if (!match || match.index === undefined) return []
  let i = match.index + match[0].length
  const out = []
  while (i < slice.length) {
    while (i < slice.length && /\s|,/.test(slice[i])) i++
    if (slice[i] === ']') break
    if (slice[i] !== '"') {
      i++
      continue
    }
    i++
    let buf = ''
    while (i < slice.length) {
      const ch = slice[i]
      if (ch === '\\' && i + 1 < slice.length) {
        buf += slice[i] + slice[i + 1]
        i += 2
        continue
      }
      if (ch === '"') {
        i++
        break
      }
      buf += ch
      i++
    }
    const unescaped = buf
      .replace(/\\n/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
    const cleaned = clampTwoSentences(unescaped)
    if (cleaned.length > 10) out.push(cleaned)
  }
  return out
}

export function parseDescriptionsJsonLoose(content) {
  let raw = String(content ?? '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model output')
  }
  const slice = raw.slice(start, end + 1)
  const arr = extractDescriptionsArrayStringsFromSlice(slice)
  if (arr.length < 2) throw new Error('Loose JSON parse found fewer than 2 description strings')
  return arr.slice(0, 6)
}

/**
 * Four paragraphs separated by blank lines — reliable for small LLMs (no JSON quoting issues).
 */
export function parseDescriptionsFourBlocks(content) {
  let raw = stripLlmDescriptionPreamble(String(content ?? '').trim())
  const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  raw = raw.replace(/^\s*json\s*/i, '').trim()
  const blocks = raw
    .split(/\n\s*\n+/)
    .map((b) =>
      clampTwoSentences(
        b
          .replace(/^["']+|["']+$/g, '')
          .replace(/^\d+\s*[\).:-]\s*/, '')
          .trim(),
      ),
    )
    .filter((b) => b.length > 12 && !isBoilerplateDescriptionLine(b))
  if (blocks.length < 2) {
    throw new Error('Expected at least 2 non-empty paragraphs separated by blank lines')
  }
  return blocks.slice(0, 4)
}

/**
 * Try JSON, then four-block prose, then line-based. Always returns 2+ items or throws.
 */
export function parseDescriptionsFlexible(content) {
  const raw = String(content ?? '').trim()
  if (!raw) throw new Error('Empty model response')

  const tryJson = () => parseDescriptionsJson(content)
  const tryJsonLoose = () => parseDescriptionsJsonLoose(content)
  const tryBlocks = () => parseDescriptionsFourBlocks(content)
  const tryPlain = () => {
    const a = parsePlainDescriptionLines(content, 6)
    if (a.length >= 2) return a.slice(0, 4)
    throw new Error('plain lines parse insufficient')
  }
  const tryMany = () => parseManyDescriptionsFromLlm(content, 6)

  try {
    return tryJson()
  } catch {
    /* */
  }
  try {
    return tryJsonLoose()
  } catch {
    /* */
  }
  try {
    return tryBlocks()
  } catch {
    /* */
  }
  try {
    return tryPlain()
  } catch {
    /* */
  }
  const many = tryMany()
  if (many.length >= 2) return many.slice(0, 4)
  throw new Error('Could not parse descriptions from model output')
}

/** Last resort: split summary into short pairs of sentences (no LLM). */
function fallbackDescriptionsFromSummary(summary) {
  const s = String(summary || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length < 40) return []
  const sentences = s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)
  const out = []
  for (let i = 0; i < sentences.length && out.length < 4; i += 2) {
    const pair = [sentences[i], sentences[i + 1]].filter(Boolean).join(' ')
    if (pair.length > 15) out.push(clampTwoSentences(pair))
  }
  if (out.length < 2 && s.length > 100) {
    const mid = Math.floor(s.length / 2)
    out.push(clampTwoSentences(s.slice(0, mid)))
    out.push(clampTwoSentences(s.slice(mid)))
  }
  return out.filter((x) => x.length > 12).slice(0, 4)
}

export function stripJsonArrayNoise(line) {
  let t = String(line ?? '').trim()
  t = t.replace(/^[\s]*[-*•\d.)]+\s*/, '')
  t = t.replace(/^[\[{]\s*["']?/, '').replace(/["']?\s*[\]}]\s*,?\s*$/, '')
  t = t.replace(/^["']+|["']+$/g, '')
  t = t.replace(/^\[\s*/, '').replace(/\s*\]$/, '')
  if (/^["']/.test(t)) {
    try {
      const q = t.match(/^["']([\s\S]*?)["']\s*,?$/)
      if (q) t = q[1]
    } catch {
      /* */
    }
  }
  return t.trim()
}

function clampDescriptionLine(s, maxLen = 520) {
  let t = String(s).trim()
  if (t.length <= maxLen) return t
  const cut = t.slice(0, maxLen)
  const lastPeriod = cut.lastIndexOf('.')
  return lastPeriod > 80 ? cut.slice(0, lastPeriod + 1) : `${cut.trim()}…`
}

/** Strip LLM meta-intros ("Here are the YouTube openers", etc.). */
export function stripLlmDescriptionPreamble(raw) {
  let s = String(raw ?? '').trim()
  const lines = s.split(/\n/)
  while (lines.length > 0) {
    const L = lines[0].trim()
    const throat =
      (/^(here|below)\s+(are|is)\b/i.test(L) &&
        /opener|description|youtube|lines?|options?|paragraphs?|suggestions?/i.test(
          L,
        )) ||
      /^these\s+(are|were)\b/i.test(L) ||
      (/^in\s+this\s+(video|section|description)\b/i.test(L) &&
        /\b(here|below|following)\b/i.test(L))
    if (throat && L.length < 220) {
      lines.shift()
    } else {
      break
    }
  }
  return lines.join('\n').trim()
}

function isBoilerplateDescriptionLine(line) {
  const t = String(line).trim()
  if (t.length < 12) return true
  return /^(here|below)\s+(are|is)\b/i.test(t) || /^these are\b/i.test(t)
}

/** Prefer plain lines — no JSON array in model output. */
export function parsePlainDescriptionLines(content, max = 5) {
  let raw = stripLlmDescriptionPreamble(String(content || '').trim())
  const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  raw = stripLlmDescriptionPreamble(raw)
  const lines = raw
    .split(/\n+/)
    .map(stripJsonArrayNoise)
    .map((s) => s.replace(/^description\s*\d+\s*[:.)-]\s*/i, '').trim())
    .filter((s) => {
      if (s.length < 36) return false
      if (isBoilerplateDescriptionLine(s)) return false
      if (/^\s*[\[{]/.test(s)) return false
      if (/^["']?\s*[\[{]/.test(s)) return false
      return true
    })
  const out = []
  for (const line of lines) {
    out.push(clampDescriptionLine(line))
    if (out.length >= max) break
  }
  return out
}

export function parseManyDescriptionsFromLlm(content, max = 6) {
  const plain = parsePlainDescriptionLines(content, max)
  if (plain.length >= 2) return plain
  const raw = String(content || '').trim()
  let jsonStr = raw
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) jsonStr = fence[1].trim()
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return parsed
        .map((t) => clampDescriptionLine(stripJsonArrayNoise(String(t))))
        .filter((p) => p.length > 35 && !isBoilerplateDescriptionLine(p))
        .slice(0, max)
    }
  } catch {
    /* */
  }
  return stripLlmDescriptionPreamble(raw)
    .split(/\n\n+/)
    .map((p) => clampDescriptionLine(stripJsonArrayNoise(p)))
    .filter((p) => p.length > 35 && !isBoilerplateDescriptionLine(p))
    .slice(0, max)
}

async function chatOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_RECOMMEND_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.22, num_predict: 420 },
    }),
  })
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const c = data?.message?.content
  if (typeof c !== 'string') throw new Error('Bad Ollama response')
  return c
}

/**
 * @param {{ transcript: string, summary: string, categoryId: number, categoryLabel?: string, tags?: string[], region?: string }} opts
 */
export async function recommendDescriptionsPipeline(opts) {
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
      'Could not build a content summary from the transcript — check Ollama (OLLAMA_PIPELINE_MODEL).',
    )
  }

  const artifact = loadArtifact()
  const bucket = getBucket(artifact, categoryId, region)
  const trendCtx =
    typeof bucket?.llmTrendContext === 'string' && bucket.llmTrendContext.trim()
      ? bucket.llmTrendContext.trim()
      : getLlmTrendContextForCategory(categoryId, region)

  const prompt = `You write YouTube description lines. Use ONLY the CONTENT SUMMARY for facts.

PREFERRED OUTPUT (no JSON — avoids parse errors):
Write exactly 4 paragraphs. Separate each paragraph with one blank line (double newline).
Each paragraph: at most 2 short sentences, plain English, under 360 characters.
No markdown fences, no "Here are", no numbering like "1."

ALTERNATIVE if you must use JSON (single line, valid JSON only):
{"descriptions":["line1","line2","line3","line4"]}
If you use JSON: do not put double-quote characters inside any string (use single quotes in wording instead).

Rules:
- Only content from CONTENT SUMMARY below. No invented people, numbers, events, or topics.
- No hashtags, no "Hey guys", "In this video", "smash like".
- Category: "${categoryLabel}" — tone may match; facts still from summary only.

CONTENT SUMMARY:
---
${summary.slice(0, 4000)}
---
`

  let content
  try {
    content = await chatOllama(prompt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Ollama unreachable or failed (${msg}). Start Ollama and: ollama pull ${OLLAMA_RECOMMEND_MODEL}`,
    )
  }

  let candidates
  try {
    candidates = parseDescriptionsFlexible(content)
  } catch (e) {
    const summaryFallback = fallbackDescriptionsFromSummary(summary)
    if (summaryFallback.length >= 2) {
      candidates = summaryFallback
    } else {
      throw new Error(
        `Could not parse descriptions: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  candidates = [...new Set(candidates.map((s) => s.trim()).filter(Boolean))].slice(0, 4)

  const scored = candidates.map((text) => ({
    text,
    score: scoreDescriptionVsSummary(text, summary, transcript),
  }))
  scored.sort((a, b) => b.score - a.score)

  return {
    recommendations: scored,
    datasetTrendUsed: Boolean(trendCtx),
    /** Final LLM summary used (same as Input enrich when generated on the fly). */
    contentSummary: summary,
  }
}
