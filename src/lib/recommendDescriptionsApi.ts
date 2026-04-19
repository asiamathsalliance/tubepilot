export type DescriptionRecommendation = {
  text: string
  score: number
}

export type RecommendDescriptionsResponse = {
  recommendations: DescriptionRecommendation[]
  datasetTrendUsed: boolean
  /** Populated when the server generated a summary (fills project aiContentSummary). */
  contentSummary?: string
}

export async function recommendDescriptionsApi(body: {
  transcript: string
  /** Omit or empty to let the server build the same summary as the enrich pipeline. */
  summary?: string
  categoryId: number
  categoryLabel?: string
  tags: string[]
  region?: string
}): Promise<RecommendDescriptionsResponse> {
  const res = await fetch('/api/recommend-descriptions', {
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
  return JSON.parse(text) as RecommendDescriptionsResponse
}
