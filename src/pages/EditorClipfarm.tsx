import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { useProject } from '../hooks/useProject'
import { useVideoPreview } from '../hooks/useVideoPreview'
import { analyzeExcitementApi } from '../lib/analyzeExcitementApi'
import { formatSecRange } from '../lib/formatClipTime'
import {
  getFarmPreviewSession,
  setFarmPreviewSession,
} from '../lib/storage'
import {
  clipsFromHighSegments,
  deleteTimelineSegment,
  ensureTimelineSegmentIds,
  resizeSegmentEdge,
  translateSegment,
} from '../lib/timeline'
import type { ClipFarmQueueEntry, TimelineSegment } from '../types/project'
import clsx from 'clsx'

const FILMSTRIP_FRAMES = 12
const CLICK_DRAG_THRESHOLD_PX = 4
/** Minimum time the analyze UI stays in loading (ms). */
const MIN_ANALYZE_SPIN_MS = 3200

function captureFrameFromVideo(
  v: HTMLVideoElement,
  timeSec: number,
  durationSec: number,
  w: number,
  h: number,
  q = 0.65,
): Promise<string> {
  return new Promise((resolve) => {
    const t = Math.min(Math.max(0, timeSec), Math.max(0.001, durationSec) - 0.04)
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/jpeg', q))
        } else resolve('')
      } catch {
        resolve('')
      }
    }
    v.addEventListener('seeked', onSeeked)
    v.currentTime = t
  })
}

export function EditorClipfarm() {
  const { id } = useParams<{ id: string }>()
  const { project, updateProject } = useProject(id)
  const { previewUrl, videoFile } = useVideoPreview(id)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hiddenVideoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  /** Outer timeline chrome (regions + scrub) — shared width for drag/scrub math. */
  const timelineChromeRef = useRef<HTMLDivElement>(null)
  const scrubbingRef = useRef(false)
  const segmentEditRef = useRef<{
    type: 'move' | 'resize-start' | 'resize-end'
    index: number
    startClientX: number
    initialSegs: TimelineSegment[]
  } | null>(null)
  const bodyPressRef = useRef<{
    index: number
    startClientX: number
    startClientY: number
    initialSegs: TimelineSegment[]
  } | null>(null)
  const [scrub, setScrub] = useState(0)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzePhase, setAnalyzePhase] = useState<
    'reading' | 'scoring' | null
  >(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [filmstripUrls, setFilmstripUrls] = useState<string[]>([])
  const [farmPreviewById, setFarmPreviewById] = useState<Record<string, string>>({})
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    segmentIndex: number
  } | null>(null)
  const segments = project?.timelineSegments

  const duration = project?.totalDurationSec ?? 120

  const durationRef = useRef(duration)
  durationRef.current = duration
  const selectedIdsRef = useRef(project?.selectedClipIds ?? [])
  selectedIdsRef.current = project?.selectedClipIds ?? []
  const updateProjectRef = useRef(updateProject)
  updateProjectRef.current = updateProject

  useEffect(() => {
    if (!project?.id) return
    const ts = project.timelineSegments
    if (ts?.length && ts.some((s) => !s.id)) {
      updateProject({
        timelineSegments: ensureTimelineSegmentIds(ts),
      })
    }
  }, [project?.id, project?.timelineSegments, updateProject])

  const farmQueue: ClipFarmQueueEntry[] = project?.clipFarmQueue ?? []

  useEffect(() => {
    if (!project?.id) return
    const next: Record<string, string> = {}
    for (const e of farmQueue) {
      const p = getFarmPreviewSession(project.id, e.id)
      if (p) next[e.id] = p
    }
    setFarmPreviewById(next)
  }, [project?.id, farmQueue])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !previewUrl) return
    el.currentTime = scrub * duration
  }, [scrub, duration, previewUrl])

  const setScrubFromClientX = useCallback(
    (clientX: number) => {
      const tr = trackRef.current
      if (!tr || duration <= 0) return
      const rect = tr.getBoundingClientRect()
      const x = Math.min(rect.right, Math.max(rect.left, clientX))
      const t = (x - rect.left) / rect.width
      setScrub(Math.min(1, Math.max(0, t)))
    },
    [duration],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const edit = segmentEditRef.current
      if (edit && timelineChromeRef.current) {
        const rect = timelineChromeRef.current.getBoundingClientRect()
        const totalDx = e.clientX - edit.startClientX
        const deltaNorm = rect.width > 0 ? totalDx / rect.width : 0
        let next: TimelineSegment[]
        if (edit.type === 'move') {
          next = translateSegment(edit.initialSegs, edit.index, deltaNorm)
        } else if (edit.type === 'resize-start') {
          next = resizeSegmentEdge(edit.initialSegs, edit.index, 'start', deltaNorm)
        } else {
          next = resizeSegmentEdge(edit.initialSegs, edit.index, 'end', deltaNorm)
        }
        updateProjectRef.current({
          timelineSegments: next,
          clips: clipsFromHighSegments(next, durationRef.current),
          selectedClipIds: selectedIdsRef.current,
        })
        return
      }
      const press = bodyPressRef.current
      if (press) {
        const dx = e.clientX - press.startClientX
        const dy = e.clientY - press.startClientY
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
          segmentEditRef.current = {
            type: 'move',
            index: press.index,
            startClientX: press.startClientX,
            initialSegs: press.initialSegs,
          }
          bodyPressRef.current = null
        }
      }
      if (!scrubbingRef.current) return
      setScrubFromClientX(e.clientX)
    }
    const onUp = () => {
      const press = bodyPressRef.current
      if (press && !segmentEditRef.current) {
        const s = press.initialSegs[press.index]
        if (s) {
          const el = videoRef.current
          const dur = durationRef.current
          const t = s.start * dur
          setScrub(s.start)
          if (el) {
            el.currentTime = t
            void el.play().catch(() => {})
          }
        }
      }
      scrubbingRef.current = false
      segmentEditRef.current = null
      bodyPressRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setScrubFromClientX])

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement
    if (t.closest('[data-segment-body]') || t.closest('[data-segment-edge]')) {
      return
    }
    e.preventDefault()
    scrubbingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setScrubFromClientX(e.clientX)
  }

  function onVideoLoadedMetadata() {
    const el = videoRef.current
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return
    updateProject({ totalDurationSec: Math.round(el.duration) })
  }

  function onVideoTimeUpdate() {
    if (scrubbingRef.current || segmentEditRef.current) return
    const el = videoRef.current
    if (!el || duration <= 0) return
    setScrub(el.currentTime / duration)
  }

  /** Only high-excitement regions are shown and edited (calm/low segments hidden). */
  const segs: TimelineSegment[] = useMemo(() => {
    const raw = segments
    if (!raw?.length) return []
    return ensureTimelineSegmentIds(raw).filter((s) => s.engagement === 'high')
  }, [segments])

  const isShort = (project?.videoLength ?? 'long') === 'short'

  /** Filmstrip thumbnails (only after excitement regions exist). */
  useEffect(() => {
    const v = hiddenVideoRef.current
    if (!v || !previewUrl || duration <= 0 || !segs.length) {
      setFilmstripUrls([])
      return
    }
    v.src = previewUrl
    let cancelled = false

    const seekCapture = (timeSec: number, w: number, h: number, q = 0.55): Promise<string> => {
      return captureFrameFromVideo(v, timeSec, duration, w, h, q)
    }

    ;(async () => {
      await new Promise<void>((r) => {
        const onMeta = () => {
          v.removeEventListener('loadeddata', onMeta)
          r()
        }
        v.addEventListener('loadeddata', onMeta)
      })

      const strip: string[] = []
      for (let i = 0; i < FILMSTRIP_FRAMES; i++) {
        if (cancelled) return
        const t = ((i + 0.5) / FILMSTRIP_FRAMES) * duration
        strip.push(await seekCapture(t, 160, 90))
      }
      if (!cancelled) setFilmstripUrls(strip)
    })()

    return () => {
      cancelled = true
    }
  }, [previewUrl, duration, segs.length])

  async function runExcitementAnalysis() {
    if (!videoFile) return
    setAnalyzeError(null)
    setAnalyzeLoading(true)
    setAnalyzePhase('reading')
    const t0 = Date.now()
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      setAnalyzePhase('scoring')
      const r = await analyzeExcitementApi(videoFile)
      const durSec = Math.round(r.durationSec)
      const highOnly = r.segments.filter((s) => s.engagement === 'high')
      const withIds = ensureTimelineSegmentIds(highOnly)
      updateProject({
        timelineSegments: withIds,
        totalDurationSec: durSec,
        clips: clipsFromHighSegments(withIds, r.durationSec),
        selectedClipIds: project?.selectedClipIds ?? [],
        excitementAnalysisMeta: {
          windowSec: r.meta.windowSec,
          weights: r.meta.weights,
          analyzedAt: r.analyzedAt,
          capped: r.capped,
          fullDurationSec: r.fullDurationSec,
        },
      })
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e))
    } finally {
      const elapsed = Date.now() - t0
      if (elapsed < MIN_ANALYZE_SPIN_MS) {
        await new Promise((r) =>
          setTimeout(r, MIN_ANALYZE_SPIN_MS - elapsed),
        )
      }
      setAnalyzeLoading(false)
      setAnalyzePhase(null)
    }
  }

  function onSegmentBodyPointerDown(e: React.PointerEvent, index: number) {
    if (e.button !== 0) return
    e.stopPropagation()
    bodyPressRef.current = {
      index,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialSegs: segs.map((s) => ({ ...s })),
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function onEdgePointerDown(
    e: React.PointerEvent,
    index: number,
    edge: 'start' | 'end',
  ) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    bodyPressRef.current = null
    segmentEditRef.current = {
      type: edge === 'start' ? 'resize-start' : 'resize-end',
      index,
      startClientX: e.clientX,
      initialSegs: segs.map((s) => ({ ...s })),
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function onSegmentContextMenu(e: React.MouseEvent, index: number) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, segmentIndex: index })
  }

  function deleteSegmentAt(index: number) {
    const next = deleteTimelineSegment(segs, index)
    updateProject({
      timelineSegments: next,
      clips: clipsFromHighSegments(next, duration),
      selectedClipIds: project?.selectedClipIds ?? [],
    })
    setContextMenu(null)
  }

  async function addSegmentToFarm(index: number) {
    if (!project) return
    const s = segs[index]
    const sid = s.id ?? `seg-${index}`
    const startSec = s.start * duration
    const endSec = s.end * duration
    const entryId = crypto.randomUUID()
    const label = `Exciting region ${index + 1}`
    const entry: ClipFarmQueueEntry = {
      id: entryId,
      segmentId: sid,
      label,
      startSec,
      endSec,
      engagement: s.engagement,
    }
    const nextQueue = [...farmQueue, entry]
    updateProject({ clipFarmQueue: nextQueue })
    setContextMenu(null)

    const v = hiddenVideoRef.current
    if (!v || !previewUrl) return
    v.src = previewUrl
    const mid = (startSec + endSec) / 2
    const dataUrl = await captureFrameFromVideo(v, mid, duration, 320, 180)
    if (dataUrl) {
      setFarmPreviewSession(project.id, entryId, dataUrl)
      setFarmPreviewById((prev) => ({ ...prev, [entryId]: dataUrl }))
    }
  }

  if (!id || !project) {
    return (
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Project not found. <Link to="/">Back to dashboard</Link>
      </p>
    )
  }

  const cappedNote = project.excitementAnalysisMeta?.capped

  const menuSegmentIndex = contextMenu?.segmentIndex

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
        Editor + Clipfarm
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Highlights show higher-energy moments only. Each region is independent: drag the body to
        move it, drag the side lines to resize; click the body to play from its start; right-click
        for actions. Use Next in the footer when you are ready to review
        {isShort ? '.' : ' — clip farm is optional.'}
      </p>

      <video
        ref={hiddenVideoRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden
      />

      <div
        className={clsx(
          'mt-8 grid gap-8',
          isShort ? '' : 'lg:grid-cols-[1fr_320px]',
        )}
      >
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black shadow-sm dark:border-zinc-700">
            {previewUrl ? (
              <video
                ref={videoRef}
                src={previewUrl}
                controls
                playsInline
                className="aspect-video w-full object-contain"
                onLoadedMetadata={onVideoLoadedMetadata}
                onTimeUpdate={onVideoTimeUpdate}
              />
            ) : (
              <div className="flex aspect-video items-center justify-center bg-zinc-900 text-sm text-zinc-500">
                No video — add an MP4 on the Input page
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Timeline</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!videoFile || analyzeLoading}
                  onClick={() => void runExcitementAnalysis()}
                  className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {analyzeLoading
                    ? analyzePhase === 'reading'
                      ? 'Reading video…'
                      : 'Scoring moments…'
                    : 'Analyze Excitement'}
                </button>
              </div>
            </div>
            {analyzeError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{analyzeError}</p>
            ) : null}
            {cappedNote ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Analysis used the first 30 minutes only (long video cap). Full length:{' '}
                {project.excitementAnalysisMeta?.fullDurationSec != null
                  ? `${Math.round(project.excitementAnalysisMeta.fullDurationSec)}s`
                  : '—'}
              </p>
            ) : null}

            {/* Regions (thin) + scrub — shared chrome; regions row flush with scrub (no vertical gap) */}
            <div
              ref={timelineChromeRef}
              data-timeline-chrome
              className="w-full overflow-hidden rounded-lg border border-zinc-300 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900"
            >
              <div
                className={clsx(
                  'relative w-full overflow-visible',
                  segs.length > 0 ? 'h-6' : 'flex h-7 items-center justify-center',
                )}
              >
                {segs.length === 0 ? (
                  <p className="px-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                    No highlight regions yet — run Analyze excitement to detect exciting segments.
                  </p>
                ) : (
                  segs.map((s, i) => {
                    const sid = s.id ?? `seg-${i}`
                    return (
                      <div
                        key={sid}
                        data-segment-block
                        className="absolute top-0 h-full"
                        style={{
                          left: `${s.start * 100}%`,
                          width: `${Math.max(0.001, s.end - s.start) * 100}%`,
                          zIndex: 10 + i,
                        }}
                      >
                        <div
                          data-segment-edge="start"
                          role="slider"
                          tabIndex={0}
                          aria-label={`Resize start of region ${i + 1}`}
                          className="absolute left-0 top-0 z-30 flex h-full w-3.5 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                          onPointerDown={(e) => onEdgePointerDown(e, i, 'start')}
                        >
                          <span className="h-full w-0.5 rounded-full bg-white shadow-md ring-1 ring-black/25" />
                        </div>
                        <button
                          type="button"
                          data-segment-body
                          title="Drag to move, click to play"
                          onPointerDown={(e) => onSegmentBodyPointerDown(e, i)}
                          onContextMenu={(e) => onSegmentContextMenu(e, i)}
                          className={clsx(
                            'absolute inset-y-0 z-10 border border-zinc-500/90 bg-emerald-500 outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-orange-500',
                            i === 0 ? 'left-2.5' : 'left-3',
                            i === segs.length - 1 ? 'right-2.5' : 'right-3',
                          )}
                        >
                          <span className="pointer-events-none absolute inset-y-0.5 left-0.5 right-0.5 rounded-sm border border-black/10 bg-black/5" />
                        </button>
                        <div
                          data-segment-edge="end"
                          role="slider"
                          tabIndex={0}
                          aria-label={`Resize end of region ${i + 1}`}
                          className="absolute right-0 top-0 z-30 flex h-full w-3.5 translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                          onPointerDown={(e) => onEdgePointerDown(e, i, 'end')}
                        >
                          <span className="h-full w-0.5 rounded-full bg-white shadow-md ring-1 ring-black/25" />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div
                ref={trackRef}
                role="slider"
                tabIndex={0}
                data-scrub-track
                aria-label="Timeline scrubber"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(scrub * 100)}
                className="relative h-2.5 w-full cursor-pointer border-t border-zinc-300/90 bg-zinc-200/95 outline-none dark:border-zinc-600 dark:bg-zinc-800/95 focus-visible:ring-2 focus-visible:ring-orange-500 rounded-b-[inherit]"
                onPointerDown={onTrackPointerDown}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 0.05 : 0.01
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    setScrub((s) => Math.max(0, s - step))
                  }
                  if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    setScrub((s) => Math.min(1, s + step))
                  }
                }}
              >
                <div
                  className="pointer-events-none absolute bottom-0 left-0 top-0 bg-orange-500/35"
                  style={{ width: `${scrub * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute bottom-0 top-0 w-px bg-orange-700 dark:bg-orange-300"
                  style={{ left: `${scrub * 100}%`, transform: 'translateX(-50%)' }}
                />
              </div>
            </div>

            <div className="flex h-12 w-full gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800">
              {filmstripUrls.length > 0
                ? filmstripUrls.map((url, i) => (
                    <div
                      key={`fs-${i}`}
                      className="min-w-0 flex-1 bg-zinc-100 dark:bg-zinc-900"
                      style={{
                        backgroundImage: url ? `url(${url})` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    />
                  ))
                : Array.from({ length: FILMSTRIP_FRAMES }).map((_, i) => (
                    <div
                      key={`fs-ph-${i}`}
                      className="min-w-0 flex-1 animate-pulse bg-zinc-300 dark:bg-zinc-800"
                    />
                  ))}
            </div>
          </div>

        </div>

        {!isShort ? (
        <aside className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Clip farm</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Right-click a region → Add to Clip farm. Preview appears here after you add.
            </p>
            {farmQueue.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-400">No regions queued yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {farmQueue.map((e) => {
                  const prev = farmPreviewById[e.id]
                  return (
                    <li
                      key={e.id}
                      className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700"
                    >
                      <div
                        className="aspect-video w-full overflow-hidden rounded border border-zinc-200 bg-zinc-100 bg-cover bg-center dark:border-zinc-600 dark:bg-zinc-800"
                        style={prev ? { backgroundImage: `url(${prev})` } : undefined}
                      >
                        {!prev ? (
                          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                            No preview
                          </div>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs font-medium text-zinc-900 dark:text-zinc-50">
                        {e.label}
                      </p>
                      <p className="text-[10px] tabular-nums text-zinc-500">
                        {formatSecRange(e.startSec, e.endSec)}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>
        ) : (
          <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400 lg:col-span-1">
            Clip farm is available for long-form videos. Switch to Long on the Input step to queue
            highlight clips.
          </p>
        )}
      </div>

      {contextMenu ? (
        <div
          className="fixed inset-0 z-[95]"
          aria-hidden
          onMouseDown={(e) => {
            e.preventDefault()
            setContextMenu(null)
          }}
        />
      ) : null}

      {contextMenu && menuSegmentIndex != null
        ? createPortal(
            <div
              role="menu"
              className="fixed z-[100] min-w-[180px] rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={() => deleteSegmentAt(menuSegmentIndex)}
              >
                Delete region
              </button>
              {!isShort ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={() => void addSegmentToFarm(menuSegmentIndex)}
                >
                  Add to Clip farm
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
