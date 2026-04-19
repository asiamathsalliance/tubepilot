import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { INPUT_FORM_ID } from '../components/layout/ProjectWorkflowLayout'
import { useProject } from '../hooks/useProject'
import { useVideoPreview } from '../hooks/useVideoPreview'
import { projectStepPath } from '../lib/routes'
import {
  enrichTranscriptClient,
  transcribeVideoOnly,
} from '../lib/videoPipeline'
import { YOUTUBE_CATEGORIES } from '../lib/youtubeCategories'
import clsx from 'clsx'

const REGIONS = [
  { code: 'GLOBAL', label: 'All regions (pooled)' },
  { code: 'US', label: 'US' },
  { code: 'CA', label: 'CA' },
  { code: 'GB', label: 'GB' },
  { code: 'DE', label: 'DE' },
  { code: 'FR', label: 'FR' },
  { code: 'IN', label: 'IN' },
  { code: 'JP', label: 'JP' },
  { code: 'KR', label: 'KR' },
  { code: 'MX', label: 'MX' },
  { code: 'RU', label: 'RU' },
] as const

export function Input() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { project, updateProject } = useProject(id)
  const { previewUrl, videoFile, setVideoFile } = useVideoPreview(id)
  const [transcribeLoading, setTranscribeLoading] = useState(false)
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const pipelineGen = useRef(0)
  const enrichGen = useRef(0)
  const projectRef = useRef(project)
  projectRef.current = project

  const [stepWarning, setStepWarning] = useState<string | null>(null)

  useEffect(() => {
    setStepWarning(null)
  }, [project?.niche, project?.youtubeCategoryId, videoFile])

  /** Transcript arrives after Whisper; Ollama may still run (enrichLoading). */
  const waitingForPipeline =
    Boolean(videoFile) &&
    Boolean(
      !project?.transcript?.trim() || transcribeLoading || enrichLoading,
    )
  const showVideoPlayer =
    Boolean(previewUrl && videoFile) &&
    !waitingForPipeline &&
    !pipelineError

  useEffect(() => {
    if (!videoFile) {
      setPipelineError(null)
      return
    }
    const gen = ++pipelineGen.current
    let cancelled = false
    setTranscribeLoading(true)
    setEnrichLoading(false)
    setPipelineError(null)
    ;(async () => {
      try {
        const { transcript } = await transcribeVideoOnly(videoFile)
        if (cancelled || gen !== pipelineGen.current) return
        updateProject({ transcript })
        setTranscribeLoading(false)
        setEnrichLoading(true)
        const p = projectRef.current
        if (!p) return
        const catLabel =
          p.youtubeCategoryId != null
            ? YOUTUBE_CATEGORIES.find((c) => c.id === p.youtubeCategoryId)?.label
            : undefined
        const { titles, summary } = await enrichTranscriptClient(transcript, {
          categoryId: p.youtubeCategoryId,
          region: p.trendingRegion ?? 'GLOBAL',
          categoryLabel: catLabel,
          tags: [],
        })
        if (cancelled || gen !== pipelineGen.current) return
        updateProject({
          aiTitleSuggestions: titles,
          aiContentSummary: summary,
        })
      } catch (e) {
        if (cancelled || gen !== pipelineGen.current) return
        setPipelineError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled && gen === pipelineGen.current) {
          setTranscribeLoading(false)
          setEnrichLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [videoFile, updateProject])

  useEffect(() => {
    if (!videoFile) return
    const gen = ++enrichGen.current
    let cancelled = false
    const tid = window.setTimeout(() => {
      setEnrichLoading(true)
      setPipelineError(null)
      ;(async () => {
        try {
          const pr = projectRef.current
          if (!pr) return
          const trNow = pr.transcript?.trim()
          if (!trNow || trNow.length < 20) return
          const catLabel =
            pr.youtubeCategoryId != null
              ? YOUTUBE_CATEGORIES.find((c) => c.id === pr.youtubeCategoryId)
                  ?.label
              : undefined
          const { titles, summary } = await enrichTranscriptClient(trNow, {
            categoryId: pr.youtubeCategoryId,
            region: pr.trendingRegion ?? 'GLOBAL',
            categoryLabel: catLabel,
            tags: [],
          })
          if (cancelled || gen !== enrichGen.current) return
          updateProject({
            aiTitleSuggestions: titles,
            aiContentSummary: summary,
          })
        } catch (e) {
          if (cancelled || gen !== enrichGen.current) return
          setPipelineError(e instanceof Error ? e.message : String(e))
        } finally {
          if (!cancelled && gen === enrichGen.current) {
            setEnrichLoading(false)
          }
        }
      })()
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(tid)
    }
  }, [
    videoFile,
    project?.youtubeCategoryId,
    project?.trendingRegion,
    updateProject,
  ])

  if (!id || !project) {
    return (
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Project not found. <Link to="/">Back to dashboard</Link>
      </p>
    )
  }

  const projectId = id

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!project) return
    setStepWarning(null)
    const missing: string[] = []
    if (!(project.niche ?? '').trim()) missing.push('niche')
    if (project.youtubeCategoryId == null) missing.push('YouTube category')
    if (!videoFile) missing.push('video upload')
    if (missing.length > 0) {
      setStepWarning(
        `Complete the following before continuing: ${missing.join(', ')}.`,
      )
      return
    }
    updateProject({ lastEditedStep: 'video-info' })
    navigate(projectStepPath(projectId, 'video-info'))
  }

  function onFileChange(f: File | null) {
    if (!f) {
      setVideoFile(null)
      updateProject({
        videoFileMeta: undefined,
        transcript: undefined,
        aiTitleSuggestions: undefined,
        aiContentSummary: undefined,
      })
      return
    }
    setVideoFile(f)
    updateProject({
      videoFileMeta: { name: f.name, size: f.size, type: f.type },
      transcript: undefined,
      aiTitleSuggestions: undefined,
      aiContentSummary: undefined,
    })
  }

  function setYoutubeCategory(idNum: number) {
    const label =
      YOUTUBE_CATEGORIES.find((c) => c.id === idNum)?.label ?? String(idNum)
    updateProject({
      youtubeCategoryId: idNum,
      category: label,
    })
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
        Input
      </h1>
      <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
        Set niche, category, and upload your video.
      </p>

      {stepWarning ? (
        <p
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
        >
          {stepWarning}
        </p>
      ) : null}

      <form
        id={INPUT_FORM_ID}
        onSubmit={onSubmit}
        className="surface-3d mt-8 space-y-6 p-6"
      >
        <div>
          <span className="label-lg block">Format</span>
          <div className="mt-2 flex rounded-xl border-2 border-zinc-300 p-1 dark:border-zinc-600">
            {(['long', 'short'] as const).map((len) => (
              <button
                key={len}
                type="button"
                onClick={() => {
                  updateProject({ videoLength: len })
                }}
                className={`flex-1 rounded-lg py-2.5 text-base font-medium transition ${
                  (project.videoLength ?? 'long') === len
                    ? 'bg-orange-600 text-white shadow-sm dark:bg-orange-600'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {len === 'long' ? 'Long' : 'Short'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="niche" className="label-lg block">
            Niche
          </label>
          <input
            id="niche"
            type="text"
            value={project.niche ?? ''}
            onChange={(e) => updateProject({ niche: e.target.value })}
            className="input-field mt-2"
            placeholder="e.g. productivity, fitness"
          />
        </div>

        <div>
          <label htmlFor="yt-cat" className="label-lg block">
            YouTube Category
          </label>
          <select
            id="yt-cat"
            value={project.youtubeCategoryId ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) {
                updateProject({ youtubeCategoryId: undefined })
                return
              }
              setYoutubeCategory(Number(v))
            }}
            className={clsx(
              'input-field mt-2',
              project.youtubeCategoryId == null
                ? 'text-zinc-400 dark:text-zinc-500'
                : 'text-zinc-900 dark:text-zinc-100',
            )}
          >
            <option value="">Select category</option>
            {YOUTUBE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} — {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="trend-region" className="label-lg block">
            Trending Region
          </label>
          <select
            id="trend-region"
            value={project.trendingRegion ?? 'GLOBAL'}
            onChange={(e) =>
              updateProject({ trendingRegion: e.target.value || 'GLOBAL' })
            }
            className="input-field mt-2 text-zinc-900 dark:text-zinc-100"
          >
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-zinc-500">
            Choose a region for trending context, or All Regions for a combined
            view.
          </p>
        </div>

        <div>
          <label className="label-lg block">Video (MP4)</label>
          <input
            type="file"
            accept="video/mp4,video/*"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-base text-zinc-600 file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-200 file:px-4 file:py-2.5 file:text-base file:font-medium file:text-zinc-800 hover:file:bg-orange-100 dark:text-zinc-400 dark:file:bg-zinc-700 dark:file:text-zinc-100 dark:hover:file:bg-orange-950/40"
          />
          {project.videoFileMeta && (
            <p className="mt-1 text-sm text-zinc-500">
              {project.videoFileMeta.name} (
              {(project.videoFileMeta.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        {previewUrl && videoFile ? (
          <div className="overflow-hidden rounded-xl border-2 border-zinc-300 dark:border-zinc-600">
            {waitingForPipeline && !pipelineError ? (
              <div className="bg-zinc-950">
                <div
                  className={`w-full animate-pulse bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-900 ${
                    (project.videoLength ?? 'long') === 'short'
                      ? 'aspect-[9/16] max-h-[min(480px,70vh)] mx-auto max-w-[min(100%,270px)]'
                      : 'aspect-video'
                  }`}
                />
                <div className="space-y-3 border-t border-zinc-800 bg-zinc-900/95 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
                    <span className="text-sm font-medium text-zinc-200">
                      {transcribeLoading
                        ? 'Transcribing…'
                        : 'Generating summary…'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-2.5 w-full animate-pulse rounded bg-zinc-700/80" />
                    <div className="h-2.5 w-4/5 animate-pulse rounded bg-zinc-700/60" />
                    <div className="h-2.5 w-3/5 animate-pulse rounded bg-zinc-700/40" />
                  </div>
                  <p className="text-xs text-zinc-500">
                    Video preview appears when transcription and analysis finish.
                  </p>
                </div>
              </div>
            ) : pipelineError ? (
              <div className="bg-zinc-950 px-4 py-6">
                <p className="text-center text-sm text-red-400">{pipelineError}</p>
                <p className="mt-2 text-center text-xs text-zinc-500">
                  Fix the issue and try uploading again if needed.
                </p>
              </div>
            ) : showVideoPlayer ? (
              <video
                src={previewUrl}
                controls
                className={
                  (project.videoLength ?? 'long') === 'short'
                    ? 'mx-auto max-h-[min(480px,70vh)] w-full max-w-[min(100%,270px)] object-contain'
                    : 'max-h-96 w-full'
                }
              />
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  )
}
