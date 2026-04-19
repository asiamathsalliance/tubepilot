export type TitleScoreBreakdown = {
  tagAndCategoryScore: number
  trendingLexicalSimilarity: number
  titleLengthScore: number
  languageStructureScore: number
  notes: string[]
}

export type TitleScoreResponse = {
  score: number
  breakdown: TitleScoreBreakdown
}

export async function scoreTitleApi(body: {
  title: string
  tags: string[]
  categoryId: number
  region?: string
}): Promise<TitleScoreResponse> {
  const res = await fetch('/api/score-title', {
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
  return JSON.parse(text) as TitleScoreResponse
}

export async function scoreTagConfidenceApi(body: {
  tag: string
  transcript: string
  tags: string[]
  categoryId: number
  region?: string
}): Promise<TitleScoreResponse> {
  const res = await fetch('/api/score-tag', {
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
  return JSON.parse(text) as TitleScoreResponse
}
