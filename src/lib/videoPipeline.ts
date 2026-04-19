export type PipelineResult = {
  transcript: string
  titles: string[]
  /** Detailed Ollama summary (4–6 sentences) used to ground titles */
  summary: string
}

function throwIfNotOk(res: Response, text: string): void {
  if (!res.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: string; hint?: string }
      msg = [j.error, j.hint].filter(Boolean).join(' — ') || text
    } catch {
      /* raw */
    }
    throw new Error(msg || `Request failed (${res.status})`)
  }
}

/**
 * Whisper only — fast; use then {@link enrichTranscriptClient} for titles + summary.
 */
export async function transcribeVideoOnly(
  videoFile: File,
): Promise<{ transcript: string }> {
  const body = new FormData()
  body.append('video', videoFile, videoFile.name)

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    body,
  })

  const text = await res.text()
  throwIfNotOk(res, text)
  const data = JSON.parse(text) as { transcript: string }
  if (typeof data.transcript !== 'string') {
    throw new Error('Invalid response from /api/transcribe')
  }
  return { transcript: data.transcript }
}

export type EnrichTranscriptOptions = {
  categoryId?: number
  region?: string
  categoryLabel?: string
  tags?: string[]
}

/**
 * Server: detailed summary first, then 5 titles from summary + Model 2 trend + structure hints.
 */
export async function enrichTranscriptClient(
  transcript: string,
  opts?: EnrichTranscriptOptions,
): Promise<{ titles: string[]; summary: string }> {
  const res = await fetch('/api/enrich-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript,
      ...(opts?.categoryId != null && !Number.isNaN(Number(opts.categoryId))
        ? { categoryId: opts.categoryId }
        : {}),
      ...(typeof opts?.region === 'string' ? { region: opts.region } : {}),
      ...(typeof opts?.categoryLabel === 'string' && opts.categoryLabel.trim()
        ? { categoryLabel: opts.categoryLabel.trim() }
        : {}),
      ...(Array.isArray(opts?.tags) && opts.tags.length
        ? { tags: opts.tags }
        : {}),
    }),
  })
  const text = await res.text()
  throwIfNotOk(res, text)
  const data = JSON.parse(text) as { titles: string[]; summary: string }
  return {
    titles: Array.isArray(data.titles) ? data.titles : [],
    summary: typeof data.summary === 'string' ? data.summary : '',
  }
}

/**
 * Full pipeline: Whisper then enrich (summary + titles).
 */
export async function runTranscribeAndTitlePipeline(
  videoFile: File,
  opts?: EnrichTranscriptOptions,
): Promise<PipelineResult> {
  const body = new FormData()
  body.append('video', videoFile, videoFile.name)
  if (opts?.categoryId != null && !Number.isNaN(Number(opts.categoryId))) {
    body.append('categoryId', String(opts.categoryId))
  }
  if (typeof opts?.region === 'string') {
    body.append('region', opts.region)
  }
  if (typeof opts?.categoryLabel === 'string' && opts.categoryLabel.trim()) {
    body.append('categoryLabel', opts.categoryLabel.trim())
  }
  if (Array.isArray(opts?.tags) && opts.tags.length) {
    body.append('tags', JSON.stringify(opts.tags))
  }

  const res = await fetch('/api/pipeline', {
    method: 'POST',
    body,
  })

  const text = await res.text()
  throwIfNotOk(res, text)

  const data = JSON.parse(text) as PipelineResult
  if (typeof data.transcript !== 'string' || !Array.isArray(data.titles)) {
    throw new Error('Invalid response from /api/pipeline')
  }
  if (typeof data.summary !== 'string') {
    data.summary = ''
  }
  return data
}
