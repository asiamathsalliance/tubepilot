/**
 * Shared LLM transcript → multi-sentence content summary (same prompt as enrich pipeline).
 */
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(
  /\/$/,
  '',
)
const OLLAMA_PIPELINE_MODEL =
  process.env.OLLAMA_PIPELINE_MODEL || 'llama3.2:1b'

function clampSentences(text, maxSentences) {
  const t = String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!t) return ''
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (parts.length <= maxSentences) return t
  return parts.slice(0, maxSentences).join(' ').trim()
}

/**
 * @param {string} transcript
 * @returns {Promise<string>}
 */
export async function fetchTranscriptContentSummary(transcript) {
  const slice = String(transcript || '').slice(0, 12000)
  const prompt = `Write a YouTube video description opening as plain text only (no JSON, no quote-wrapping the whole answer, no hashtags, no bullet points).

Requirements:
- 4–5 sentences, slightly detailed: set up the topic, who the video is for, and what viewers will learn or see.
- Stay faithful to the transcript; do not invent facts.

Transcript:
---
${slice}
---`

  let res
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_PIPELINE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.3, num_predict: 450 },
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
  return clampSentences(content.trim(), 6)
}
