import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { useProject } from '../hooks/useProject'
import { useVideoPreview } from '../hooks/useVideoPreview'
import {
  australiaDatetimeLocalToIso,
  isoToAustraliaDatetimeLocalValue,
} from '../lib/australiaTime'
import { projectStepPath } from '../lib/routes'
import { getFarmPreviewSession, loadStore } from '../lib/storage'
import { extractClipSegmentToFile } from '../lib/extractClipSegment'
import { scheduleYoutubeUpload } from '../lib/youtubeScheduleUpload'
import { formatSecRange } from '../lib/formatClipTime'
import {
  model8ScoreAtDatetimeApi,
  recommendUploadDatesModel8Api,
} from '../lib/recommendUploadDatesModel8Api'
import { reviewOverviewScores } from '../lib/scores'
import type { ClipFarmQueueEntry, TimelineSegment } from '../types/project'
import type { ProjectWorkflowOutletContext } from '../components/layout/workflowOutletContext'
import clsx from 'clsx'

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

const MIN_GENERATE_SPIN_MS = 650

async function withMinSpin<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  const result = await fn()
  const elapsed = Date.now() - t0
  if (elapsed < ms) {
    await new Promise((r) => setTimeout(r, ms - elapsed))
  }
  return result
}

type ScheduleState = {
  atIso: string
  score100?: number
  estimatedViews?: number
}

export function ReviewPage2() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const { registerReview2Footer } =
    useOutletContext<ProjectWorkflowOutletContext>()
  const { project, updateProject } = useProject(id)
  const { videoFile } = useVideoPreview(id)
  const [youtubeError, setYoutubeError] = useState<string | null>(null)
  const [youtubeUploading, setYoutubeUploading] = useState<Record<string, boolean>>(
    {},
  )

  const overview = project ? reviewOverviewScores(project) : null
  const titleScore = overview?.title ?? 0
  const descScore = overview?.description ?? 0
  const thumbScore = overview?.thumbnail ?? 0
  const engagementScore = overview?.engagement ?? 0

  const farmQueue: ClipFarmQueueEntry[] = project?.clipFarmQueue ?? []

  const [schedules, setSchedules] = useState<Record<string, ScheduleState>>({})
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({})
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    const plan = project?.uploadPlanByAssetId
    if (!plan) return
    setSchedules((prev) => {
      const merged: Record<string, ScheduleState> = { ...prev }
      for (const [assetId, row] of Object.entries(plan)) {
        merged[assetId] = {
          atIso: row.atIso,
          score100: row.score100,
          estimatedViews: row.estimatedViews,
        }
      }
      return merged
    })
  }, [project?.id, project?.uploadPlanByAssetId])

  useEffect(() => {
    if (!highlightId || !project?.id) return
    const el = cardRefs.current[highlightId]
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, project?.id, farmQueue.length])

  const persistSchedule = useCallback(
    (assetId: string, data: ScheduleState) => {
      setSchedules((prev) => ({ ...prev, [assetId]: data }))
      const cur = project?.uploadPlanByAssetId ?? {}
      updateProject({
        uploadPlanByAssetId: {
          ...cur,
          [assetId]: {
            atIso: data.atIso,
            score100: data.score100,
            estimatedViews: data.estimatedViews,
          },
        },
      })
    },
    [project, updateProject],
  )

  const model8Context = useMemo(
    () => ({
      trendingRegion: project?.trendingRegion,
      youtubeCategoryId: project?.youtubeCategoryId,
      titleCharLen: project?.title?.length,
      descriptionCharLen: project?.description?.length,
      tagCount: project?.viewerTags?.length ?? 0,
    }),
    [
      project?.trendingRegion,
      project?.youtubeCategoryId,
      project?.title?.length,
      project?.description?.length,
      project?.viewerTags?.length,
    ],
  )

  const runYoutubeScheduleUpload = useCallback(
    async (
      assetId: string,
      atIso: string,
      clipEntry?: ClipFarmQueueEntry,
    ): Promise<boolean> => {
      if (!videoFile || !project || !id) {
        setYoutubeError(
          'Video file is missing. Go back to Input and select your MP4 again.',
        )
        return false
      }
      const pubTime = new Date(atIso).getTime()
      if (Number.isNaN(pubTime) || pubTime <= Date.now()) {
        setYoutubeError('Scheduled time must be in the future (Australia/Sydney).')
        return false
      }
      const prevRow = project.youtubeScheduledByAssetId?.[assetId]
      if (prevRow?.videoId && prevRow.atIso === atIso) return true

      setYoutubeUploading((m) => ({ ...m, [assetId]: true }))
      setYoutubeError(null)
      try {
        const store = loadStore()
        const idx = store.projects.findIndex((p) => p.id === id)
        const cur = idx >= 0 ? store.projects[idx] : project

        if (assetId === 'main') {
          const { videoId, url } = await scheduleYoutubeUpload({
            video: videoFile,
            title: project.title?.trim() || project.name || 'Untitled',
            description: project.description ?? '',
            tags: project.viewerTags ?? [],
            categoryId: project.youtubeCategoryId ?? 22,
            publishAtIso: atIso,
            isShort: project.videoLength === 'short',
            selfDeclaredMadeForKids: project.audienceKind === 'madeForKids',
            thumbnailDataUrl: project.thumbnailDataUrl,
          })
          updateProject({
            youtubeScheduledByAssetId: {
              ...(cur.youtubeScheduledByAssetId ?? {}),
              main: { videoId, url, atIso },
            },
            youtubeScheduledVideoId: videoId,
            youtubeScheduledUrl: url,
          })
        } else if (clipEntry) {
          const clipFile = await extractClipSegmentToFile(
            videoFile,
            clipEntry.startSec,
            clipEntry.endSec,
          )
          const isShort = project.videoLength === 'short'
          const { videoId, url } = await scheduleYoutubeUpload({
            video: clipFile,
            title: `${project.title?.trim() || project.name || 'Clip'} — ${clipEntry.label}`,
            description: project.description ?? '',
            tags: project.viewerTags ?? [],
            categoryId: project.youtubeCategoryId ?? 22,
            publishAtIso: atIso,
            isShort,
            selfDeclaredMadeForKids: project.audienceKind === 'madeForKids',
            thumbnailDataUrl: project.thumbnailDataUrl,
          })
          updateProject({
            youtubeScheduledByAssetId: {
              ...(cur.youtubeScheduledByAssetId ?? {}),
              [assetId]: { videoId, url, atIso },
            },
          })
        } else {
          return false
        }
        return true
      } catch (e) {
        setYoutubeError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setYoutubeUploading((m) => ({ ...m, [assetId]: false }))
      }
    },
    [project, videoFile, id, updateProject],
  )

  async function generateForMain() {
    if (!project?.id) return
    setLoadingById((m) => ({ ...m, main: true }))
    try {
      const dur = Math.max(1, project.totalDurationSec ?? 120)
      const seg: TimelineSegment = {
        id: 'main',
        start: 0,
        end: 1,
        engagement: 'high',
      }
      const r = await withMinSpin(MIN_GENERATE_SPIN_MS, () =>
        recommendUploadDatesModel8Api({
          segments: [seg],
          durationSec: dur,
          ...model8Context,
        }),
      )
      const rec = r.recommendations[0]
      if (rec) {
        persistSchedule('main', {
          atIso: rec.recommendedAt,
          score100: rec.score100,
          estimatedViews: rec.estimatedViews,
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingById((m) => ({ ...m, main: false }))
    }
  }

  async function generateForClip(entry: ClipFarmQueueEntry) {
    if (!project?.id) return
    const dur = Math.max(0.001, project.totalDurationSec ?? 120)
    const start = entry.startSec / dur
    const end = Math.min(1, entry.endSec / dur)
    const seg: TimelineSegment = {
      id: entry.segmentId,
      start,
      end: Math.max(start + 0.002, end),
      engagement: entry.engagement ?? 'high',
    }
    setLoadingById((m) => ({ ...m, [entry.id]: true }))
    try {
      const r = await withMinSpin(MIN_GENERATE_SPIN_MS, () =>
        recommendUploadDatesModel8Api({
          segments: [seg],
          durationSec: dur,
          ...model8Context,
        }),
      )
      const rec = r.recommendations[0]
      if (rec) {
        persistSchedule(entry.id, {
          atIso: rec.recommendedAt,
          score100: rec.score100,
          estimatedViews: rec.estimatedViews,
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingById((m) => ({ ...m, [entry.id]: false }))
    }
  }

  async function onDatetimeManual(
    assetId: string,
    localVal: string,
    engagement: 'high' | 'low',
  ) {
    if (!localVal || !project) return
    const iso = australiaDatetimeLocalToIso(localVal)
    setLoadingById((m) => ({ ...m, [assetId]: true }))
    try {
      const res = await model8ScoreAtDatetimeApi({
        atIso: iso,
        ...model8Context,
        engagement,
      })
      const data: ScheduleState = {
        atIso: res.recommendedAt,
        score100: res.score100,
        estimatedViews: res.estimatedViews,
      }
      persistSchedule(assetId, data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingById((m) => ({ ...m, [assetId]: false }))
    }
  }

  const confirmAndUploadAll = useCallback(async () => {
    if (!videoFile || !project || !id) {
      setYoutubeError(
        'Video file is missing. Go back to Input and select your MP4 again.',
      )
      return
    }
    setYoutubeError(null)
    let failed = false
    const mainIso = schedules.main?.atIso
    if (mainIso) {
      const ok = await runYoutubeScheduleUpload('main', mainIso)
      if (!ok) failed = true
    }
    for (const e of farmQueue) {
      const iso = schedules[e.id]?.atIso
      if (iso) {
        const ok = await runYoutubeScheduleUpload(e.id, iso, e)
        if (!ok) failed = true
      }
    }
    if (!failed) {
      updateProject({
        status: 'published',
        publishedAt: new Date().toISOString(),
      })
      navigate('/', { replace: true })
    }
  }, [
    videoFile,
    project,
    id,
    schedules,
    farmQueue,
    runYoutubeScheduleUpload,
    navigate,
    updateProject,
  ])

  const uploadingAny = useMemo(
    () => Object.values(youtubeUploading).some(Boolean),
    [youtubeUploading],
  )

  const canConfirmUpload = useMemo(() => {
    const hasMain = Boolean(schedules.main?.atIso)
    const hasClip = farmQueue.some((e) => Boolean(schedules[e.id]?.atIso))
    return hasMain || hasClip
  }, [schedules, farmQueue])

  useEffect(() => {
    registerReview2Footer({
      onConfirm: confirmAndUploadAll,
      disabled: uploadingAny || !canConfirmUpload || !videoFile,
    })
    return () => registerReview2Footer(null)
  }, [
    registerReview2Footer,
    confirmAndUploadAll,
    uploadingAny,
    canConfirmUpload,
    videoFile,
  ])

  if (!id || !project) {
    return (
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Project not found. <Link to="/">Back to dashboard</Link>
      </p>
    )
  }

  const mainThumb = project.thumbnailDataUrl
  const mainTitle = project.title?.trim() || project.name
  const mainSchedule = schedules.main

  function removeFarmEntry(entryId: string) {
    if (!project) return
    const nextQueue = farmQueue.filter((e) => e.id !== entryId)
    const plan = { ...(project.uploadPlanByAssetId ?? {}) }
    delete plan[entryId]
    const yt = { ...(project.youtubeScheduledByAssetId ?? {}) }
    delete yt[entryId]
    updateProject({
      clipFarmQueue: nextQueue,
      uploadPlanByAssetId: plan,
      youtubeScheduledByAssetId: yt,
    })
    setSchedules((prev) => {
      const next = { ...prev }
      delete next[entryId]
      return next
    })
  }

  return (
    <div className="mx-auto max-w-5xl px-2">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
        Review & Publish
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Final scores and Australia/Sydney scheduling before YouTube receives your uploads.
      </p>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Score Overview
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ['Title', titleScore],
            ['Description', descScore],
            ['Thumbnail', thumbScore],
            ['Engagement', engagementScore],
          ].map(([label, val]) => (
            <div
              key={String(label)}
              className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/80"
            >
              <dt className="text-sm text-zinc-600 dark:text-zinc-400">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums text-orange-700 dark:text-orange-300">
                {val} / 100
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10 border-t border-zinc-200 pt-10 dark:border-zinc-700">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Upload Schedule
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Recommend times or set them manually, then use <strong>Confirm and Upload</strong> in the
          footer to send everything to YouTube (Australia/Sydney).
        </p>

        <div className="mt-6 flex w-full min-w-0 flex-nowrap items-stretch justify-center gap-4 overflow-x-auto py-2">
            <div
              ref={(el) => {
                cardRefs.current.main = el
              }}
              className={clsxFloating(highlightId === 'main')}
            >
            <div
              className="aspect-square w-full max-w-[280px] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 bg-cover bg-center dark:border-zinc-600 dark:bg-zinc-800"
              style={
                mainThumb ? { backgroundImage: `url(${mainThumb})` } : undefined
              }
            >
              {!mainThumb ? (
                <div className="flex h-full items-center justify-center p-2 text-center text-xs text-zinc-500">
                  No thumbnail
                </div>
              ) : null}
            </div>
            <p
              className="mt-2 min-h-[1.25rem] truncate text-sm font-medium leading-tight text-zinc-900 dark:text-zinc-50"
              title={mainTitle}
            >
              {mainTitle}
            </p>
            <p className="text-[10px] text-zinc-500">Main video</p>
            <div className="mt-auto space-y-2 pt-3">
              <label className="block text-[10px] font-medium uppercase text-zinc-500">
                Publish time (Australia/Sydney)
              </label>
              <input
                type="datetime-local"
                value={
                  mainSchedule?.atIso
                    ? isoToAustraliaDatetimeLocalValue(mainSchedule.atIso)
                    : ''
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (v) void onDatetimeManual('main', v, 'high')
                }}
                className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              />
              <button
                type="button"
                disabled={loadingById.main}
                onClick={() => void generateForMain()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-70"
              >
                {loadingById.main ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Recommending…
                  </>
                ) : (
                  'Recommend upload date & time'
                )}
              </button>
              {youtubeUploading.main ? (
                <p className="text-[10px] text-zinc-500">Uploading to YouTube…</p>
              ) : null}
              {project.youtubeScheduledByAssetId?.main?.url ? (
                <a
                  href={project.youtubeScheduledByAssetId.main.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[10px] font-medium text-orange-700 underline dark:text-orange-400"
                >
                  Scheduled on YouTube
                </a>
              ) : null}
            </div>
            </div>

          {farmQueue.map((entry) => {
            const prev = getFarmPreviewSession(project.id, entry.id)
            const sch = schedules[entry.id]
            const eng = entry.engagement ?? 'high'
            const isHi = highlightId === entry.id
            return (
              <div
                key={entry.id}
                ref={(el) => {
                  cardRefs.current[entry.id] = el
                }}
                className={clsx(clsxFloating(isHi), 'relative')}
              >
                <button
                  type="button"
                  aria-label="Remove from clip farm"
                  onClick={() => removeFarmEntry(entry.id)}
                  className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900/80 text-lg font-medium leading-none text-white shadow hover:bg-zinc-800 dark:bg-zinc-950/90"
                >
                  −
                </button>
                <div
                  className="aspect-square w-full max-w-[280px] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 bg-cover bg-center dark:border-zinc-600 dark:bg-zinc-800"
                  style={prev ? { backgroundImage: `url(${prev})` } : undefined}
                >
                  {!prev ? (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                      No preview
                    </div>
                  ) : null}
                </div>
                <p
                  className="mt-2 min-h-[1.25rem] truncate text-sm font-medium leading-tight text-zinc-900 dark:text-zinc-50"
                  title={entry.label}
                >
                  {entry.label}
                </p>
                <p className="text-[10px] tabular-nums text-zinc-500">
                  {formatSecRange(entry.startSec, entry.endSec)}
                </p>
                <div className="mt-auto space-y-2 pt-3">
                  <label className="block text-[10px] font-medium uppercase text-zinc-500">
                    Publish time (Australia/Sydney)
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      sch?.atIso ? isoToAustraliaDatetimeLocalValue(sch.atIso) : ''
                    }
                    onChange={(e) => {
                      const v = e.target.value
                      if (v) void onDatetimeManual(entry.id, v, eng)
                    }}
                    className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                  />
                  <button
                    type="button"
                    disabled={loadingById[entry.id]}
                    onClick={() => void generateForClip(entry)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-70"
                  >
                    {loadingById[entry.id] ? (
                      <>
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Recommending…
                      </>
                    ) : (
                      'Recommend upload date & time'
                    )}
                  </button>
                  {youtubeUploading[entry.id] ? (
                    <p className="text-[10px] text-zinc-500">Uploading to YouTube…</p>
                  ) : null}
                  {project.youtubeScheduledByAssetId?.[entry.id]?.url ? (
                    <a
                      href={project.youtubeScheduledByAssetId[entry.id]!.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[10px] font-medium text-orange-700 underline dark:text-orange-400"
                    >
                      Scheduled on YouTube
                    </a>
                  ) : null}
                </div>
              </div>
            )
          })}

          <div className="flex min-h-[32rem] shrink-0 items-center justify-center self-stretch">
            <Link
              to={projectStepPath(project.id, 'editor')}
              title="Add clips from the editor"
              className="inline-flex items-center justify-center text-orange-600 transition hover:text-orange-500 dark:text-orange-400 dark:hover:text-orange-300"
            >
              <PlusIcon className="h-9 w-9" />
            </Link>
          </div>
        </div>

        {youtubeError ? (
          <p className="mt-6 text-center text-sm text-red-600 dark:text-red-400">
            {youtubeError}
          </p>
        ) : null}

        <p className="mt-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
          <Link to="/" className="font-medium text-orange-700 hover:underline dark:text-orange-400">
            Back to dashboard
          </Link>
        </p>
      </section>
    </div>
  )
}

function clsxFloating(highlight: boolean) {
  return [
    'flex h-full min-h-[32rem] w-full min-w-[260px] max-w-[320px] shrink-0 flex-col rounded-xl border bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900/90',
    highlight ? 'ring-2 ring-orange-500 ring-offset-2 dark:ring-offset-zinc-950' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
