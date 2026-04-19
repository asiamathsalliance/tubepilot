import type { ClipItem, TimelineSegment } from '../types/project'

function seg(
  start: number,
  end: number,
  engagement: TimelineSegment['engagement'],
  id: string,
): TimelineSegment {
  return { id, start, end, engagement }
}

export function buildDefaultTimeline(): TimelineSegment[] {
  return [
    seg(0, 0.12, 'low', 'seg-default-0'),
    seg(0.12, 0.42, 'high', 'seg-default-1'),
    seg(0.42, 0.58, 'low', 'seg-default-2'),
    seg(0.58, 0.88, 'high', 'seg-default-3'),
    seg(0.88, 1, 'low', 'seg-default-4'),
  ]
}

/** Ensure every segment has an id (for editor interactions). */
export function ensureTimelineSegmentIds(segments: TimelineSegment[]): TimelineSegment[] {
  return segments.map((s, i) => ({
    ...s,
    id: s.id ?? `seg-${i}-${Math.round(s.start * 1e6)}`,
  }))
}

const MIN_SEG_WIDTH = 0.008

/** Resize one segment's start or end only (regions are independent; may overlap or gap). */
export function resizeSegmentEdge(
  initialSegments: TimelineSegment[],
  index: number,
  edge: 'start' | 'end',
  deltaNorm: number,
): TimelineSegment[] {
  const segs = initialSegments.map((s) => ({ ...s }))
  if (index < 0 || index >= segs.length) return segs
  const s = initialSegments[index]
  if (edge === 'start') {
    let ns = s.start + deltaNorm
    ns = Math.max(0, Math.min(ns, s.end - MIN_SEG_WIDTH))
    segs[index].start = ns
  } else {
    let ne = s.end + deltaNorm
    ne = Math.min(1, Math.max(ne, s.start + MIN_SEG_WIDTH))
    segs[index].end = ne
  }
  return segs
}

/** Move one segment along the timeline without changing its duration. */
export function translateSegment(
  initialSegments: TimelineSegment[],
  index: number,
  deltaNorm: number,
): TimelineSegment[] {
  const segs = initialSegments.map((s) => ({ ...s }))
  if (index < 0 || index >= segs.length) return segs
  const s = initialSegments[index]
  const w = s.end - s.start
  if (w < MIN_SEG_WIDTH) return segs
  let newStart = s.start + deltaNorm
  let newEnd = s.end + deltaNorm
  if (newStart < 0) {
    newStart = 0
    newEnd = w
  }
  if (newEnd > 1) {
    newEnd = 1
    newStart = 1 - w
  }
  segs[index].start = newStart
  segs[index].end = newEnd
  return segs
}

/** Remove one segment; others are unchanged (independent regions). */
export function deleteTimelineSegment(segments: TimelineSegment[], index: number): TimelineSegment[] {
  if (segments.length <= 1) return segments
  if (index < 0 || index >= segments.length) return segments
  return segments.filter((_, i) => i !== index)
}

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return !(a.end <= b.start || a.start >= b.end)
}

function randBetween(rng: () => number, lo: number, hi: number) {
  return lo + rng() * (hi - lo)
}

/**
 * Up to 3 high-excitement regions: fixed 1:09→1:33 (69s–93s), plus two non-overlapping
 * windows of random length 10–15s elsewhere (for the rest of the timeline).
 */
export function buildHardcodedExcitementSegments(
  durationSec: number,
  rng: () => number = Math.random,
): TimelineSegment[] {
  const D = Math.max(1, durationSec)
  // 1:09 → 1:33
  let s1 = 69
  let e1 = 93
  if (e1 > D) {
    e1 = D
    s1 = Math.max(0, e1 - 24)
  }
  if (s1 >= e1 - 0.05) {
    s1 = 0
    e1 = Math.min(D, Math.max(s1 + 10, D * 0.25))
  }
  const regions: { start: number; end: number }[] = [{ start: s1, end: e1 }]

  const overlapsAny = (r: { start: number; end: number }) =>
    regions.some((x) => rangesOverlap(x, r))

  for (let attempt = 0; attempt < 50 && regions.length < 3; attempt++) {
    const len = randBetween(rng, 10, 15)
    const start = randBetween(rng, 0, Math.max(0, D - len))
    const end = Math.min(D, start + len)
    if (end <= start + 0.05) continue
    const cand = { start, end }
    if (!overlapsAny(cand)) regions.push(cand)
  }

  regions.sort((a, b) => a.start - b.start)
  return regions.map((r) => ({
    id: crypto.randomUUID(),
    start: r.start / D,
    end: r.end / D,
    engagement: 'high' as const,
  }))
}

export function clipsFromHighSegments(
  segments: TimelineSegment[],
  durationSec: number,
): ClipItem[] {
  const d = Math.max(0.001, durationSec)
  const clips: ClipItem[] = []
  let n = 0
  segments.forEach((s, i) => {
    if (s.engagement === 'high') {
      n += 1
      const startSec = s.start * d
      const endSec = s.end * d
      const sid = s.id ?? `seg-${i}`
      clips.push({
        id: `clip-${sid}`,
        sourceSegmentIndex: i,
        score: 72 + ((i * 7) % 25),
        label: `Highlight ${n}`,
        startSec,
        endSec,
      })
    }
  })
  return clips
}
