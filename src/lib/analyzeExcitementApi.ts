import type { TimelineSegment } from '../types/project'

export type ExcitementAnalysisMeta = {
  windowSec: number
  weights: { w1: number; w2: number; w3: number }
  analyzedAt: string
  capped?: boolean
  fullDurationSec?: number
}

export type AnalyzeExcitementResult = {
  durationSec: number
  fullDurationSec: number
  capped: boolean
  segments: TimelineSegment[]
  analyzedAt: string
  meta: Omit<ExcitementAnalysisMeta, 'analyzedAt' | 'capped' | 'fullDurationSec'>
}

export async function analyzeExcitementApi(
  videoFile: File,
): Promise<AnalyzeExcitementResult> {
  const fd = new FormData()
  fd.append('video', videoFile, videoFile.name || 'video.mp4')
  const res = await fetch('/api/analyze-excitement', {
    method: 'POST',
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: string; hint?: string }
      msg = [j.error, j.hint].filter(Boolean).join(' — ') || text
    } catch {
      /* raw */
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const data = JSON.parse(text) as {
    durationSec: number
    fullDurationSec: number
    capped: boolean
    segments: TimelineSegment[]
    analyzedAt: string
    meta: AnalyzeExcitementResult['meta']
  }
  return {
    durationSec: data.durationSec,
    fullDurationSec: data.fullDurationSec,
    capped: data.capped,
    segments: data.segments,
    analyzedAt: data.analyzedAt,
    meta: data.meta,
  }
}
