import type { Project, TimelineSegment } from '../types/project'

const HEURISTIC_WEIGHT = 0.25

/** Component scores 0–100 for the combined heuristic panel (equal weights). */
export function heuristicPanelScoreParts(project: Project): {
  title: number
  tags: number
  description: number
  thumbnail: number
} {
  const title = clamp100(project.titleConfidenceScore)
  const tagRec = project.model3TagRecommendations
  const tags =
    tagRec && tagRec.length > 0
      ? tagRec.reduce((a, r) => a + clamp100(r.score), 0) / tagRec.length
      : 0
  const descRec = project.model3DescriptionRecommendations
  const description =
    descRec && descRec.length > 0
      ? Math.max(...descRec.map((r) => clamp100(r.score)))
      : 0
  const thumbnail = clamp100(project.model4ThumbnailScore)
  return {
    title: round1(title),
    tags: round1(tags),
    description: round1(description),
    thumbnail: round1(thumbnail),
  }
}

/** 0.25×title + 0.25×tags + 0.25×description + 0.25×thumbnail (each 0–100). */
export function heuristicPanelScore(project: Project): number {
  const p = heuristicPanelScoreParts(project)
  const total =
    HEURISTIC_WEIGHT * p.title +
    HEURISTIC_WEIGHT * p.tags +
    HEURISTIC_WEIGHT * p.description +
    HEURISTIC_WEIGHT * p.thumbnail
  return round1(total)
}

function clamp100(n: number | undefined): number {
  if (n == null || Number.isNaN(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export type FocusField = 'title' | 'description' | 'thumbnail' | 'tags'

export function mockScoreForField(
  project: Project,
  focus: FocusField,
): number {
  const title = project.title ?? ''
  const desc = project.description ?? ''
  const hasThumb = !!project.thumbnailDataUrl
  const tags = project.viewerTags ?? []

  const base = (s: string) => Math.min(100, 40 + Math.min(60, s.length * 2))

  switch (focus) {
    case 'title':
      return Math.round(base(title) + (title.length > 8 ? 5 : 0))
    case 'description':
      return Math.round(base(desc) + (desc.length > 40 ? 8 : 0))
    case 'thumbnail':
      return Math.round(hasThumb ? 88 : 42)
    case 'tags': {
      const joined = tags.join(' ')
      return Math.round(
        Math.min(100, 38 + Math.min(50, tags.length * 6) + joined.length),
      )
    }
    default:
      return 50
  }
}

export function suggestionsForField(
  focus: FocusField,
  niche: string | undefined,
): string[] {
  const n = niche?.trim() || 'your niche'
  switch (focus) {
    case 'title':
      return [
        `${n}: quick wins in under 60 seconds`,
        `I tried this so you don't have to — ${n}`,
        `The one habit that changed my ${n} workflow`,
      ]
    case 'description':
      return [
        `Hook viewers in the first line, then deliver 3 concrete takeaways about ${n}.`,
        `Add a CTA and one proof point (stat or mini story) to boost retention.`,
        `Mention who this is for and what they will get by the end.`,
      ]
    case 'thumbnail':
      return [
        `High contrast face + 3–5 word headline`,
        `Single focal subject; avoid clutter at small sizes`,
        `Brand color bar at bottom for consistency`,
      ]
    case 'tags':
      return [
        `Mix broad reach tags with 1–2 niche phrases from ${n}.`,
        `Reuse words that appear in your title and description.`,
        `Order tags by relevance; avoid duplicates and stuffing.`,
      ]
    default:
      return []
  }
}

export function engagementRatioFromSegments(
  segments: TimelineSegment[] | undefined,
): number {
  if (!segments?.length) return 0
  let high = 0
  let total = 0
  for (const s of segments) {
    const len = Math.max(0, s.end - s.start)
    total += len
    if (s.engagement === 'high') high += len
  }
  if (total === 0) return 0
  return high / total
}

export function mockTitleScore(project: Project): number {
  return mockScoreForField(project, 'title')
}

export function mockDescriptionScore(project: Project): number {
  return mockScoreForField(project, 'description')
}

export function mockThumbnailScore(project: Project): number {
  return mockScoreForField(project, 'thumbnail')
}

export function engagementScorePercent(project: Project): number {
  const ratio = engagementRatioFromSegments(project.timelineSegments)
  return Math.min(100, Math.max(0, Math.round(ratio * 100)))
}

/** Review page overview: real heuristic-based components, capped 0–100. */
export function reviewOverviewScores(project: Project): {
  title: number
  description: number
  thumbnail: number
  engagement: number
} {
  const p = heuristicPanelScoreParts(project)
  const engagement = engagementScorePercent(project)
  const cap = (n: number) => Math.min(100, Math.max(0, Math.round(n)))
  return {
    title: cap(p.title),
    description: cap(p.description),
    thumbnail: cap(p.thumbnail),
    engagement: cap(engagement),
  }
}

/** Deterministic mock views/impressions from publish date (YYYY-MM-DD). */
export function estimatedPerformance(publishDate: string): {
  views: number
  impressions: number
} {
  const d = new Date(publishDate + 'T12:00:00')
  const t = d.getTime()
  const day = Math.floor(t / 86400000)
  const wave = 0.5 + 0.5 * Math.sin(day / 17)
  const baseViews = 8000 + Math.floor((day % 500) * 40 * wave)
  const impressions = Math.floor(baseViews * (4.2 + (day % 7) * 0.15))
  return { views: baseViews, impressions }
}
