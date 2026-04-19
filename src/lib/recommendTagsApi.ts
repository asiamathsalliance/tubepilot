import type { TitleScoreBreakdown } from './titleScoreApi'

export type Model3TagRecommendation = {
  tag: string
  score: number
  breakdown: TitleScoreBreakdown
}

export type RecommendTagsResponse = {
  recommendations: Model3TagRecommendation[]
  candidateCount: number
  datasetTagsUsed: number
}

export async function recommendTagsApi(body: {
  transcript: string
  categoryId: number
  categoryLabel?: string
  tags: string[]
  region?: string
}): Promise<RecommendTagsResponse> {
  const res = await fetch('/api/recommend-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  return JSON.parse(text) as RecommendTagsResponse
}
