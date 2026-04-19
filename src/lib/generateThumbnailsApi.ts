import type { ThumbnailScoreBreakdown } from './thumbnailScoreApi'

export type GeneratedThumbnailItem = {
  dataUrl: string
  score: number
  breakdown?: ThumbnailScoreBreakdown
  scoreError?: string
}

function parseNdjsonError(text: string, status: number): never {
  let msg = text
  try {
    const j = JSON.parse(text) as { error?: string; hint?: string }
    msg = [j.error, j.hint].filter(Boolean).join(' — ') || text
  } catch {
    /* raw */
  }
  throw new Error(msg || `HTTP ${status}`)
}

/**
 * NDJSON stream: each completed image is sent as soon as it is generated + scored.
 */
export async function generateThumbnailsStreamApi(opts: {
  title?: string
  summary?: string
  /** Viewer tags — sent to the server to anchor thumbnail subject matter. */
  tags?: string[]
  n?: number
  onResult: (index: number, item: GeneratedThumbnailItem) => void
}): Promise<void> {
  const fd = new FormData()
  fd.append('stream', '1')
  if (opts.title?.trim()) fd.append('title', opts.title.trim())
  if (opts.summary?.trim()) fd.append('summary', opts.summary.trim())
  if (opts.tags?.length) fd.append('tags', JSON.stringify(opts.tags))
  fd.append('n', String(opts.n ?? 1))

  const res = await fetch('/api/generate-thumbnails', {
    method: 'POST',
    body: fd,
  })

  if (!res.ok) {
    const text = await res.text()
    parseNdjsonError(text, res.status)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('No response body for thumbnail stream')
  }

  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    for (;;) {
      const nl = buf.indexOf('\n')
      if (nl < 0) break
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const row = JSON.parse(line) as {
        index: number
        result: GeneratedThumbnailItem
      }
      opts.onResult(row.index, row.result)
    }
  }
}

export async function generateThumbnailsApi(opts: {
  title?: string
  summary?: string
  tags?: string[]
  n?: number
}): Promise<{ results: GeneratedThumbnailItem[] }> {
  const fd = new FormData()
  if (opts.title?.trim()) fd.append('title', opts.title.trim())
  if (opts.summary?.trim()) fd.append('summary', opts.summary.trim())
  if (opts.tags?.length) fd.append('tags', JSON.stringify(opts.tags))
  fd.append('n', String(opts.n ?? 1))

  const res = await fetch('/api/generate-thumbnails', {
    method: 'POST',
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) {
    parseNdjsonError(text, res.status)
  }
  return JSON.parse(text) as { results: GeneratedThumbnailItem[] }
}
