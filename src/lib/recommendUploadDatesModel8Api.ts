import type { TimelineSegment } from '../types/project'

export type Model8UploadRecommendation = {
  segmentId: string
  recommendedAt: string
  note: string
  score100?: number
  estimatedViews?: number
}

export type RecommendUploadDatesModel8Result = {
  model: string
  region: string
  recommendations: Model8UploadRecommendation[]
}

export async function recommendUploadDatesModel8Api(body: {
  segments: TimelineSegment[]
  durationSec: number
  trendingRegion?: string
  youtubeCategoryId?: number
  titleCharLen?: number
  descriptionCharLen?: number
  tagCount?: number
}): Promise<RecommendUploadDatesModel8Result> {
  const res = await fetch('/api/recommend-upload-dates-model8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: string }
      msg = j.error || text
    } catch {
      /* raw */
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return JSON.parse(text) as RecommendUploadDatesModel8Result
}

export type Model8ScoreAtDatetimeResult = {
  recommendedAt: string
  score100: number
  estimatedViews: number
  note: string
}

export async function model8ScoreAtDatetimeApi(body: {
  atIso: string
  trendingRegion?: string
  youtubeCategoryId?: number
  titleCharLen?: number
  descriptionCharLen?: number
  tagCount?: number
  engagement?: 'high' | 'low'
}): Promise<Model8ScoreAtDatetimeResult> {
  const res = await fetch('/api/model8-score-at-datetime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: string }
      msg = j.error || text
    } catch {
      /* raw */
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return JSON.parse(text) as Model8ScoreAtDatetimeResult
}
