/**
 * Model 8 — recommend upload datetimes per timeline region + heuristic score/views.
 * Aligns with feature ideas in models/model8-youtube-trending/scripts/train.py
 * (title length, tag count, category, publish_hour, publish_dow). No sklearn at runtime.
 */

const MIN_SEG_WIDTH = 0.002

/**
 * Map Model-8-style score (0–100) to a display view count (monotonic, capped).
 * Uses exp curve so higher scores lift estimates without claiming dataset-calibrated MAE.
 */
export function estimatedViewsFromScore100(score100) {
  const s = Math.min(100, Math.max(0, Number(score100) || 0))
  const base = Math.round(Math.expm1(s / 22) * 4200 + 800)
  return Math.min(12_000_000, Math.max(120, base))
}

/**
 * Heuristic 0–100 from context + chosen publish hour/dow (UTC interpretation).
 */
export function scoreUploadContext(input) {
  const region = String(input.trendingRegion || 'US').toUpperCase()
  const cat = Number(input.youtubeCategoryId)
  const titleLen = Math.min(500, Math.max(0, Number(input.titleCharLen) || 0))
  const descLen = Math.min(5000, Math.max(0, Number(input.descriptionCharLen) || 0))
  const tagCount = Math.min(40, Math.max(0, Number(input.tagCount) || 0))
  const engagementHigh = input.engagement === 'high'
  const d = input.atDate ? new Date(input.atDate) : new Date()
  const hourUTC = d.getUTCHours()
  const dow = d.getUTCDay()

  const peak = peakHourUtcForRegion(region)

  let score = 48
  score += engagementHigh ? 10 : 4
  score += Math.min(12, tagCount * 0.9)
  score += titleLen > 20 && titleLen < 90 ? 8 : titleLen > 5 ? 4 : 0
  score += descLen > 80 ? 5 : 0
  if (!Number.isNaN(cat) && cat >= 0) score += 4

  const hourDist = Math.min(Math.abs(hourUTC - peak.hourUTC), 24 - Math.abs(hourUTC - peak.hourUTC))
  score += Math.max(0, 10 - hourDist * 1.2)

  const prefDow = engagementHigh ? [4, 5, 6] : [2, 3, 4]
  const dowBonus = prefDow.includes(dow) ? 8 : 2
  score += dowBonus

  return Math.min(100, Math.round(score))
}

/**
 * @param {object} input
 * @param {Array<{ id?: string, start: number, end: number, engagement: string }>} input.segments
 * @param {number} [input.durationSec]
 * @param {string} [input.trendingRegion]
 * @param {number} [input.youtubeCategoryId]
 * @param {number} [input.titleCharLen]
 * @param {number} [input.descriptionCharLen]
 * @param {number} [input.tagCount]
 */
export function recommendUploadDatesModel8(input) {
  const segments = input.segments || []
  const durationSec = Math.max(1, Number(input.durationSec) || 120)
  const region = String(input.trendingRegion || 'US').toUpperCase()
  const now = new Date()
  const tagCount = Number(input.tagCount) || 0
  const titleCharLen = Number(input.titleCharLen) || 0
  const descriptionCharLen = Number(input.descriptionCharLen) || 0
  const youtubeCategoryId = input.youtubeCategoryId

  const peak = peakHourUtcForRegion(region)
  const recommendations = []

  segments.forEach((seg, i) => {
    const id = seg.id || `seg-${i}`
    const start = Math.max(0, Math.min(1, Number(seg.start) || 0))
    const end = Math.max(start + MIN_SEG_WIDTH, Math.min(1, Number(seg.end) || 1))
    const mid = ((start + end) / 2) * durationSec
    const high = seg.engagement === 'high'

    const targetDow = pickTargetDow(high, i, region)
    const d = nextUploadUtc(now, targetDow, peak.hourUTC, i)

    const score100 = scoreUploadContext({
      trendingRegion: region,
      youtubeCategoryId,
      titleCharLen,
      descriptionCharLen,
      tagCount,
      engagement: seg.engagement,
      atDate: d.toISOString(),
    })
    const estimatedViews = estimatedViewsFromScore100(score100)

    const note = [
      high ? 'Higher-excitement region → weekend-adjacent slot (Model 8 heuristic).' : 'Steadier region → mid-week slot (Model 8 heuristic).',
      `Trending region ${region}: ${peak.label}.`,
      `Clip center ≈ ${mid.toFixed(0)}s in source.`,
    ].join(' ')

    recommendations.push({
      segmentId: id,
      recommendedAt: d.toISOString(),
      note,
      score100,
      estimatedViews,
    })
  })

  return {
    model: 'model8-upload-heuristic',
    region,
    recommendations,
  }
}

/**
 * Score an arbitrary publish datetime (manual picker) with same heuristic.
 */
export function scoreUploadAtDatetime(input) {
  const at = input.atIso ? new Date(input.atIso) : new Date()
  if (Number.isNaN(at.getTime())) {
    throw new Error('Invalid atIso')
  }
  const score100 = scoreUploadContext({
    trendingRegion: input.trendingRegion,
    youtubeCategoryId: input.youtubeCategoryId,
    titleCharLen: input.titleCharLen,
    descriptionCharLen: input.descriptionCharLen,
    tagCount: input.tagCount,
    engagement: input.engagement,
    atDate: at,
  })
  const estimatedViews = estimatedViewsFromScore100(score100)
  return {
    recommendedAt: at.toISOString(),
    score100,
    estimatedViews,
    note: `Scored for ${at.toISOString()} (Model 8 heuristic).`,
  }
}

function peakHourUtcForRegion(region) {
  if (region === 'GB' || region === 'UK' || region === 'DE' || region === 'FR') {
    return { hourUTC: 14, label: 'EU afternoon peak (approx)' }
  }
  if (region === 'IN') {
    return { hourUTC: 6, label: 'India morning peak (approx UTC)' }
  }
  if (region === 'JP' || region === 'KR') {
    return { hourUTC: 11, label: 'JP/KR daytime peak (approx UTC)' }
  }
  if (region === 'GLOBAL') {
    return { hourUTC: 17, label: 'Global blend (UTC)' }
  }
  return { hourUTC: 19, label: 'US primetime proxy (~2pm ET)' }
}

function pickTargetDow(high, index, region) {
  if (region === 'JP' || region === 'KR') {
    return high ? 5 + (index % 2) : 2 + (index % 3)
  }
  if (high) {
    return [4, 5, 6][index % 3]
  }
  return [2, 3, 4][index % 3]
}

/** Stagger regions across days, then snap to preferred weekday + peak hour (UTC). */
function nextUploadUtc(from, targetDow, hourUTC, segmentIndex) {
  const d = new Date(from.getTime())
  d.setUTCMinutes(0, 0, 0)
  d.setUTCDate(d.getUTCDate() + segmentIndex * 2)
  let add = (targetDow - d.getUTCDay() + 7) % 7
  if (add === 0 && d.getUTCHours() >= hourUTC) add = 7
  d.setUTCDate(d.getUTCDate() + add)
  d.setUTCHours(hourUTC, 0, 0, 0)
  return d
}
