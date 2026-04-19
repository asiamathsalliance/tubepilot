import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useProject } from '../hooks/useProject'
import { useVideoPreview } from '../hooks/useVideoPreview'
import {
  australiaDatetimeLocalToIso,
  isoToAustraliaDatetimeLocalValue,
} from '../lib/australiaTime'
import { projectStepPath } from '../lib/routes'
import { getFarmPreviewSession, loadStore } from '../lib/storage'
import { scheduleYoutubeUpload } from '../lib/youtubeScheduleUpload'
import { formatSecRange } from '../lib/formatClipTime'
import {
  model8ScoreAtDatetimeApi,
  recommendUploadDatesModel8Api,
} from '../lib/recommendUploadDatesModel8Api'
import { reviewOverviewScores } from '../lib/scores'
import type { ClipFarmQueueEntry, TimelineSegment } from '../types/project'

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
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
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
    ) => {
      if (!videoFile || !project || !id) {
        setYoutubeError(
          'Video file is missing. Go back to Input and select your MP4 again.',
        )
        return
      }
      const pubTime = new Date(atIso).getTime()
      if (Number.isNaN(pubTime) || pubTime <= Date.now()) {
        setYoutubeError('Scheduled time must be in the future (Australia/Sydney).')
        return
      }
      const prevRow = project.youtubeScheduledByAssetId?.[assetId]
      if (prevRow?.videoId && prevRow.atIso === atIso) return

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
          const { videoId, url } = await scheduleYoutubeUpload({
            video: videoFile,
            title: `${project.title?.trim() || project.name || 'Clip'} — ${clipEntry.label}`,
            description: project.description ?? '',
            tags: [...(project.viewerTags ?? []), 'Shorts'],
            categoryId: project.youtubeCategoryId ?? 22,
            publishAtIso: atIso,
            isShort: true,
            trimStartSec: clipEntry.startSec,
            trimEndSec: clipEntry.endSec,
          })
          updateProject({
            youtubeScheduledByAssetId: {
              ...(cur.youtubeScheduledByAssetId ?? {}),
              [assetId]: { videoId, url, atIso },
            },
          })
        }
      } catch (e) {
        setYoutubeError(e instanceof Error ? e.message : String(e))
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
        await runYoutubeScheduleUpload('main', rec.recommendedAt)
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
        await runYoutubeScheduleUpload(entry.id, rec.recommendedAt, entry)
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
      const clipEntry =
        assetId === 'main' ? undefined : farmQueue.find((e) => e.id === assetId)
      await runYoutubeScheduleUpload(assetId, data.atIso, clipEntry)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingById((m) => ({ ...m, [assetId]: false }))
    }
  }

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
        Times use <strong>Australia / Sydney</strong>. Choosing a publish time uploads to YouTube
        (private until the scheduled time).
      </p>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
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
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Upload Schedule
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          One card for your main video and one per clip. Generate a suggested time or pick a date and
          time; uploads start when the time is set.
        </p>

        <div className="mt-6 flex flex-wrap items-end justify-center gap-6">
          <div
            ref={(el) => {
              cardRefs.current.main = el
            }}
            className={clsxFloating(highlightId === 'main')}
          >
            <div
              className="aspect-square w-full max-w-[220px] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 bg-cover bg-center dark:border-zinc-600 dark:bg-zinc-800"
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
            <p className="mt-2 line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {mainTitle}
            </p>
            <p className="text-[10px] text-zinc-500">Main video</p>
            <div className="mt-3 space-y-2">
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
                    Generating…
                  </>
                ) : (
                  'Generate upload date & time'
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

          <div className="flex flex-col items-center justify-center self-center">
            <Link
              to={projectStepPath(project.id, 'editor')}
              title="Add clip farm"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-orange-500 bg-orange-50 text-orange-700 shadow-sm transition hover:ring-2 hover:ring-orange-400 hover:shadow-md dark:border-orange-600 dark:bg-orange-950/50 dark:text-orange-300 dark:hover:ring-orange-500"
            >
              <span className="text-2xl font-light leading-none">+</span>
            </Link>
            <span className="mt-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Clip farm
            </span>
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
                className={clsxFloating(isHi)}
              >
                <div
                  className="aspect-square w-full max-w-[220px] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 bg-cover bg-center dark:border-zinc-600 dark:bg-zinc-800"
                  style={prev ? { backgroundImage: `url(${prev})` } : undefined}
                >
                  {!prev ? (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                      No preview
                    </div>
                  ) : null}
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {entry.label}
                </p>
                <p className="text-[10px] tabular-nums text-zinc-500">
                  {formatSecRange(entry.startSec, entry.endSec)}
                </p>
                <div className="mt-3 space-y-2">
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
                        Generating…
                      </>
                    ) : (
                      'Generate upload date & time'
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
                  <button
                    type="button"
                    onClick={() => removeFarmEntry(entry.id)}
                    className="w-full rounded-lg border border-zinc-300 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Remove from Clip farm
                  </button>
                </div>
              </div>
            )
          })}
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
    'w-full max-w-[240px] rounded-xl border bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900/90',
    highlight ? 'ring-2 ring-orange-500 ring-offset-2 dark:ring-offset-zinc-950' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
