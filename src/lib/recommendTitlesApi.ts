import type { TitleScoreBreakdown } from './titleScoreApi'

export type Model3Recommendation = {
  title: string
  score: number
  breakdown: TitleScoreBreakdown
}

export type RecommendTitlesResponse = {
  recommendations: Model3Recommendation[]
  candidateCount: number
  datasetExamplesUsed: number
}

export async function recommendTitlesApi(body: {
  transcript: string
  categoryId: number
  categoryLabel?: string
  tags: string[]
  region?: string
  /** AI content summary — strongly preferred; server can build one if omitted. */
  summary?: string
}): Promise<RecommendTitlesResponse> {
  const res = await fetch('/api/recommend-titles', {
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
  return JSON.parse(text) as RecommendTitlesResponse
}
