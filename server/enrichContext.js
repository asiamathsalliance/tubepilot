/**
 * Model 2 bucket context + lightweight title-structure hints for enrich pipeline.
 */
import { loadArtifact } from './scoreTitle.js'

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

/**
 * @param {number | undefined | null} categoryId
 * @param {string | undefined} region
 * @returns {string}
 */
export function getLlmTrendContextForCategory(categoryId, region) {
  if (categoryId == null || Number.isNaN(Number(categoryId))) return ''
  try {
    const artifact = loadArtifact()
    const bucket = getBucket(artifact, Number(categoryId), region)
    if (typeof bucket?.llmTrendContext === 'string' && bucket.llmTrendContext.trim()) {
      return bucket.llmTrendContext.trim()
    }
  } catch {
    /* no artifact */
  }
  return ''
}

/**
 * Rule-based "NLP" hooks inferred from transcript (patterns only, not wording).
 * @param {string} transcript
 * @returns {string}
 */
export function titleStructureNlpHints(transcript) {
  const head = String(transcript || '').slice(0, 6000)
  const t = head.toLowerCase()
  const hints = []
  if (/\b(how to|how do i|how i)\b/.test(t)) hints.push('how-to / tutorial arc')
  if (/\d+\s*(ways|tips|reasons|things|steps|mistakes)\b/.test(t)) {
    hints.push('numbered or list-style hook')
  }
  if (/^[^.!?]*\?/.test(head.trim()) || /\n.*\?/.test(head)) {
    hints.push('question-style curiosity hook')
  }
  if (/\b(i |we went|my experience|story time|when i first)\b/.test(t)) {
    hints.push('first-person narrative')
  }
  if (/\b(vs\.?|versus|compared to|better than)\b/.test(t)) {
    hints.push('comparison / versus framing')
  }
  if (/\b(secret|truth|exposed|you need to know|watch before)\b/.test(t)) {
    hints.push('stakes / urgency / reveal framing')
  }
  if (/\b(reaction|reacts|watching)\b/.test(t)) hints.push('reaction / watch-along')
  if (/\b(fail|worst|mistake|regret)\b/.test(t)) hints.push('negative hook / lesson learned')
  if (hints.length === 0) hints.push('clear topical statement; avoid clickbait unrelated to summary')
  return hints.join('; ')
}

function tokenizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .match(/\b[a-z]{3,}\b/g) || []
}

function topFreqTerms(words, k = 14) {
  const freq = Object.create(null)
  for (const w of words) freq[w] = (freq[w] || 0) + 1
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w, c]) => `${w}×${c}`)
}

function topBigramsFromSummary(summary) {
  const sw = String(summary || '')
    .toLowerCase()
    .match(/\b[a-z]+\b/g) || []
  const bg = Object.create(null)
  for (let i = 0; i < sw.length - 1; i++) {
    const b = `${sw[i]} ${sw[i + 1]}`
    bg[b] = (bg[b] || 0) + 1
  }
  return Object.entries(bg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([b]) => b)
}

function categoryNicheSignals(categoryId, categoryLabel) {
  const id = Number(categoryId)
  const label = String(categoryLabel || '').toLowerCase()
  const parts = []
  if (id === 20 || label.includes('gaming')) {
    parts.push(
      'gaming niche: allow gameplay, update/patch, rank, clutch, meta, streamer-adjacent hooks if transcript supports',
    )
  }
  if (id === 24 || label.includes('entertain')) {
    parts.push('entertainment: reaction, viral moment, celebrity/name hooks if grounded')
  }
  if (id === 26 || label.includes('howto')) {
    parts.push('how-to/style: step framing, before/after, time-saving angle')
  }
  if (id === 22 || label.includes('blog')) {
    parts.push('people/vlog: day-in-life, story beat, emotional stake')
  }
  if (id === 10 || label.includes('music')) {
    parts.push('music: performance, cover, reaction-to-track if relevant')
  }
  if (parts.length === 0) {
    parts.push(`category ${id}: prioritize clear entity + outcome from transcript; no fake urgency`)
  }
  return parts.join(' ')
}

/**
 * Richer lexical + structural signals for title/description LLM prompts (no copying of dataset strings).
 * @param {{ transcript: string, summary?: string, tags?: string[], categoryId?: number, categoryLabel?: string }} ctx
 * @returns {string}
 */
export function buildTitleTrendNlpAnalysis(ctx) {
  const transcript = String(ctx.transcript || '')
  const summary = String(ctx.summary || '')
  const tags = Array.isArray(ctx.tags) ? ctx.tags.map(String) : []
  const categoryId = ctx.categoryId
  const categoryLabel =
    typeof ctx.categoryLabel === 'string' ? ctx.categoryLabel : ''

  const mix = [summary, transcript.slice(0, 5000)].filter(Boolean).join('\n')
  const words = tokenizeWords(mix)
  const terms = topFreqTerms(words, 14)
  const bigrams = topBigramsFromSummary(summary || transcript.slice(0, 2000))
  const wordSet = new Set(words)
  const tagHits = tags
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t) => {
      const p = t.split(/\s+/)
      return p.some((x) => wordSet.has(x)) || mix.toLowerCase().includes(t)
    })

  const caps = transcript.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) || []
  const entities = [...new Set(caps.map((c) => c.trim()).filter((c) => c.length > 2))].slice(
    0,
    10,
  )

  const avgLen =
    words.length > 0 ? words.reduce((s, w) => s + w.length, 0) / words.length : 0
  const excl = (transcript.match(/!/g) || []).length
  const ques = (transcript.match(/\?/g) || []).length
  const digits = /\d{2,}/.test(transcript) ? 'numbers/dates present' : 'few multi-digit stats'

  const tri = Object.create(null)
  for (let i = 0; i < words.length - 2; i++) {
    const t = `${words[i]} ${words[i + 1]} ${words[i + 2]}`
    tri[t] = (tri[t] || 0) + 1
  }
  const topTri = Object.entries(tri)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t)

  const niche = categoryNicheSignals(
    categoryId != null && !Number.isNaN(Number(categoryId)) ? Number(categoryId) : -1,
    categoryLabel,
  )

  return [
    `Lexical concentration (lemma-stem proxy on transcript+summary): ${terms.join(', ') || 'n/a'}`,
    `Salient bigrams (summary-first): ${bigrams.join('; ') || 'n/a'}`,
    `Sparse trigram hooks: ${topTri.join(' | ') || 'n/a'}`,
    `Viewer-tag grounding (tokens appear in content): ${tagHits.length ? tagHits.join(', ') : 'weak — titles may still echo niche generically'}`,
    `Entity-like capitalized spans: ${entities.length ? entities.join(', ') : 'none prominent'}`,
    `Surface rhetoric: avg token length ${avgLen.toFixed(2)}; !=${excl} ?=${ques}; ${digits}`,
    `Niche / category steering: ${niche}`,
  ].join('\n')
}
