import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProject } from '../hooks/useProject'
import { useVideoPreview } from '../hooks/useVideoPreview'
import { recommendDescriptionsApi } from '../lib/recommendDescriptionsApi'
import { recommendTagsApi } from '../lib/recommendTagsApi'
import { recommendTitlesApi } from '../lib/recommendTitlesApi'
import {
  generateThumbnailsStreamApi,
  type GeneratedThumbnailItem,
} from '../lib/generateThumbnailsApi'
import { scoreThumbnailApi } from '../lib/thumbnailScoreApi'
import { heuristicPanelScoreParts } from '../lib/scores'
import {
  scoreTagConfidenceApi,
  scoreTitleApi,
  type TitleScoreBreakdown,
} from '../lib/titleScoreApi'
import { YOUTUBE_CATEGORIES } from '../lib/youtubeCategories'
import { TagChipInput } from '../components/TagChipInput'
import clsx from 'clsx'

const TITLE_SCORE_DEBOUNCE_MS = 420
const TAG_SCORE_DEBOUNCE_MS = 450
const PANEL_LOAD_MS = 1000

type RecTarget = 'none' | 'title' | 'tags' | 'description' | 'thumbnailGen'

export function VideoBasicInfo() {
  const { id } = useParams<{ id: string }>()
  const { project, updateProject } = useProject(id)
  const { previewUrl } = useVideoPreview(id)
  const [recTarget, setRecTarget] = useState<RecTarget>('none')
  /** Right-hand recommendations panel lags selection by {@link PANEL_LOAD_MS} so the orange outline is instant. */
  const [delayedRecTarget, setDelayedRecTarget] = useState<RecTarget>('none')

  const [m3Loading, setM3Loading] = useState(false)
  const [m3TagsLoading, setM3TagsLoading] = useState(false)
  const [m3Error, setM3Error] = useState<string | null>(null)
  const [m3TagsError, setM3TagsError] = useState<string | null>(null)
  const [m3DescLoading, setM3DescLoading] = useState(false)
  const [m3DescError, setM3DescError] = useState<string | null>(null)
  const [thumbGenLoading, setThumbGenLoading] = useState(false)
  const [thumbApplyLoading, setThumbApplyLoading] = useState(false)
  const [thumbGenError, setThumbGenError] = useState<string | null>(null)
  /** In-memory only — stream fills slots as each txt2img finishes. */
  const [thumbGenSlots, setThumbGenSlots] = useState<
    (GeneratedThumbnailItem | 'loading')[]
  >([])
  const [m4ThumbLoading, setM4ThumbLoading] = useState(false)
  const [m2Loading, setM2Loading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [tag2Loading, setTag2Loading] = useState(false)
  const [tag2Score, setTag2Score] = useState<number | null>(null)
  const [tag2Breakdown, setTag2Breakdown] = useState<TitleScoreBreakdown | null>(
    null,
  )
  const tagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const viewerTagsKey = (project?.viewerTags ?? []).join('\0')
  const primaryViewerTag = (project?.viewerTags ?? [])[0]?.trim() ?? ''

  useEffect(() => {
    if (!project) return
    const title = project.title?.trim() ?? ''
    if (!title || project.youtubeCategoryId == null) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    let cancelled = false
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      setM2Loading(true)
      const region =
        project.trendingRegion && project.trendingRegion !== 'GLOBAL'
          ? project.trendingRegion
          : undefined
      const tags = project.viewerTags ?? []
      const categoryId = project.youtubeCategoryId!
      ;(async () => {
        try {
          const result = await scoreTitleApi({
            title,
            tags,
            categoryId,
            region,
          })
          if (!cancelled) {
            updateProject({
              titleConfidenceScore: result.score,
              titleConfidenceBreakdown: result.breakdown,
            })
          }
        } catch {
          /* keep previous score */
        } finally {
          if (!cancelled) setM2Loading(false)
        }
      })()
    }, TITLE_SCORE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [
    project?.title,
    project?.youtubeCategoryId,
    viewerTagsKey,
    project?.trendingRegion,
    project?.videoLength,
    updateProject,
  ])

  useEffect(() => {
    if (recTarget !== 'tags') {
      if (tagDebounceRef.current) {
        clearTimeout(tagDebounceRef.current)
        tagDebounceRef.current = null
      }
      setTag2Score(null)
      setTag2Breakdown(null)
      return
    }

    if (
      !primaryViewerTag ||
      !project?.transcript?.trim() ||
      project.transcript.length < 20 ||
      project.youtubeCategoryId == null
    ) {
      if (tagDebounceRef.current) {
        clearTimeout(tagDebounceRef.current)
        tagDebounceRef.current = null
      }
      setTag2Score(null)
      setTag2Breakdown(null)
      return
    }

    if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current)
    let cancelled = false
    tagDebounceRef.current = setTimeout(() => {
      tagDebounceRef.current = null
      setTag2Loading(true)
      const region =
        project.trendingRegion && project.trendingRegion !== 'GLOBAL'
          ? project.trendingRegion
          : undefined
      ;(async () => {
        try {
          const result = await scoreTagConfidenceApi({
            tag: primaryViewerTag,
            transcript: project.transcript!,
            tags: project.viewerTags ?? [],
            categoryId: project.youtubeCategoryId!,
            region,
          })
          if (!cancelled) {
            setTag2Score(result.score)
            setTag2Breakdown(result.breakdown)
          }
        } catch {
          if (!cancelled) {
            setTag2Score(null)
            setTag2Breakdown(null)
          }
        } finally {
          if (!cancelled) setTag2Loading(false)
        }
      })()
    }, TAG_SCORE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      if (tagDebounceRef.current) {
        clearTimeout(tagDebounceRef.current)
        tagDebounceRef.current = null
      }
    }
  }, [
    recTarget,
    primaryViewerTag,
    project?.transcript,
    project?.youtubeCategoryId,
    viewerTagsKey,
    project?.trendingRegion,
    project?.videoLength,
    project?.viewerTags,
  ])

  useEffect(() => {
    const url = project?.thumbnailDataUrl
    if (!url || !url.startsWith('data:')) return
    let cancelled = false
    const t = window.setTimeout(() => {
      ;(async () => {
        setM4ThumbLoading(true)
        try {
          const r = await scoreThumbnailApi(url)
          if (cancelled) return
          updateProject({
            model4ThumbnailScore: r.score,
            model4ThumbnailBreakdown: r.breakdown,
            model4LastRunNote: undefined,
          })
        } catch {
          /* keep prior score */
        } finally {
          if (!cancelled) setM4ThumbLoading(false)
        }
      })()
    }, 650)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [project?.thumbnailDataUrl, updateProject])

  useEffect(() => {
    setThumbGenSlots([])
  }, [id])

  useEffect(() => {
    if (recTarget === 'none') {
      setDelayedRecTarget('none')
      return
    }
    const timer = window.setTimeout(() => {
      setDelayedRecTarget(recTarget)
    }, PANEL_LOAD_MS)
    return () => clearTimeout(timer)
  }, [recTarget])

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (recTarget === 'none') return
      const el = e.target as HTMLElement | null
      if (!el) return
      if (el.closest('[data-vb-keep-focus]')) return
      setRecTarget('none')
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [recTarget])

  if (!id || !project) {
    return (
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Project not found. <Link to="/">Back to dashboard</Link>
      </p>
    )
  }

  const proj = project
  const thumbAspect =
    proj.videoLength === 'short' ? 'aspect-[9/16]' : 'aspect-video'
  const heuristicParts = heuristicPanelScoreParts(proj)
  const heuristicTotal =
    Math.round(
      (0.25 *
        (heuristicParts.title +
          heuristicParts.tags +
          heuristicParts.description +
          heuristicParts.thumbnail)) *
        10,
    ) / 10

  function activateRec(target: 'title' | 'tags' | 'description' | 'thumbnailGen') {
    if (recTarget === target) return
    setRecTarget(target)
  }

  const titleEdited = (proj.title?.trim().length ?? 0) > 0
  const tagsEdited = (proj.viewerTags?.length ?? 0) > 0
  const descEdited = (proj.description?.trim().length ?? 0) > 0
  const thumbEdited = Boolean(proj.thumbnailDataUrl)
  const panelLoading =
    recTarget !== 'none' && delayedRecTarget !== recTarget

  async function runModel3Recommendations() {
    if (!proj.transcript?.trim() || proj.transcript.length < 20) {
      setM3Error('Add a transcript on the Input step (run analysis) first.')
      return
    }
    if (proj.youtubeCategoryId == null) {
      setM3Error('Set a YouTube category on the Input step first.')
      return
    }
    setM3Error(null)
    setM3Loading(true)
    try {
      const catLabel =
        YOUTUBE_CATEGORIES.find((c) => c.id === proj.youtubeCategoryId)
          ?.label ?? String(proj.youtubeCategoryId)
      const res = await recommendTitlesApi({
        transcript: proj.transcript,
        categoryId: proj.youtubeCategoryId,
        categoryLabel: catLabel,
        tags: proj.viewerTags ?? [],
        region: proj.trendingRegion ?? 'GLOBAL',
        summary: (proj.aiContentSummary ?? '').trim() || undefined,
      })
      updateProject({
        model3TitleRecommendations: res.recommendations,
        model3LastRun: {
          candidateCount: res.candidateCount,
          datasetExamplesUsed: res.datasetExamplesUsed,
        },
      })
    } catch (e) {
      setM3Error(e instanceof Error ? e.message : String(e))
    } finally {
      setM3Loading(false)
    }
  }

  async function runModel3Descriptions() {
    if (!proj.transcript?.trim() || proj.transcript.length < 20) {
      setM3DescError('Add a transcript on the Input step (run analysis) first.')
      return
    }
    if (proj.youtubeCategoryId == null) {
      setM3DescError('Set a YouTube category on the Input step first.')
      return
    }
    setM3DescError(null)
    setM3DescLoading(true)
    try {
      const catLabel =
        YOUTUBE_CATEGORIES.find((c) => c.id === proj.youtubeCategoryId)
          ?.label ?? String(proj.youtubeCategoryId)
      const res = await recommendDescriptionsApi({
        transcript: proj.transcript,
        summary: (proj.aiContentSummary ?? '').trim() || undefined,
        categoryId: proj.youtubeCategoryId,
        categoryLabel: catLabel,
        tags: proj.viewerTags ?? [],
        region: proj.trendingRegion ?? 'GLOBAL',
      })
      updateProject({
        model3DescriptionRecommendations: res.recommendations,
        model3DescriptionsLastRun: {
          datasetTrendUsed: res.datasetTrendUsed,
        },
        ...(res.contentSummary?.trim()
          ? { aiContentSummary: res.contentSummary.trim() }
          : {}),
      })
    } catch (e) {
      setM3DescError(e instanceof Error ? e.message : String(e))
    } finally {
      setM3DescLoading(false)
    }
  }

  async function applyGeneratedThumbnail(slot: GeneratedThumbnailItem) {
    setThumbApplyLoading(true)
    setThumbGenError(null)
    try {
      const scored = await scoreThumbnailApi(slot.dataUrl)
      updateProject({
        thumbnailDataUrl: slot.dataUrl,
        model4ThumbnailScore: scored.score,
        model4ThumbnailBreakdown: scored.breakdown,
        model4LastRunNote: scored.trainedOnDataset
          ? `Thumbnail · ${scored.nCalibrationSamples} calibration samples`
          : 'Thumbnail · calibration placeholder',
      })
    } catch (e) {
      setThumbGenError(e instanceof Error ? e.message : String(e))
    } finally {
      setThumbApplyLoading(false)
    }
  }

  async function runThumbnailGeneration() {
    const title = (proj.title ?? '').trim()
    const summary = (proj.aiContentSummary ?? '').trim()
    if (!title && !summary) {
      setThumbGenError(
        'Add a title or AI content summary (Input step) so the thumbnail matches your video.',
      )
      return
    }
    setThumbGenError(null)
    setThumbGenLoading(true)
    const n = 1
    setThumbGenSlots(Array.from({ length: n }, () => 'loading' as const))
    try {
      await generateThumbnailsStreamApi({
        title: title || undefined,
        summary: summary || undefined,
        tags: proj.viewerTags?.length ? proj.viewerTags : undefined,
        n,
        onResult: (index, item) => {
          setThumbGenSlots((prev) => {
            const next = [...prev]
            while (next.length <= index) next.push('loading')
            next[index] = item
            return next
          })
        },
      })
    } catch (e) {
      setThumbGenError(e instanceof Error ? e.message : String(e))
      setThumbGenSlots([])
    } finally {
      setThumbGenLoading(false)
    }
  }

  async function runModel3Tags() {
    if (!proj.transcript?.trim() || proj.transcript.length < 20) {
      setM3TagsError('Add a transcript on the Input step (run analysis) first.')
      return
    }
    if (proj.youtubeCategoryId == null) {
      setM3TagsError('Set a YouTube category on the Input step first.')
      return
    }
    setM3TagsError(null)
    setM3TagsLoading(true)
    try {
      const catLabel =
        YOUTUBE_CATEGORIES.find((c) => c.id === proj.youtubeCategoryId)
          ?.label ?? String(proj.youtubeCategoryId)
      const res = await recommendTagsApi({
        transcript: proj.transcript,
        categoryId: proj.youtubeCategoryId,
        categoryLabel: catLabel,
        tags: proj.viewerTags ?? [],
        region: proj.trendingRegion ?? 'GLOBAL',
      })
      updateProject({
        model3TagRecommendations: res.recommendations,
        model3TagsLastRun: {
          candidateCount: res.candidateCount,
          datasetTagsUsed: res.datasetTagsUsed,
        },
      })
    } catch (e) {
      setM3TagsError(e instanceof Error ? e.message : String(e))
    } finally {
      setM3TagsLoading(false)
    }
  }

  function onThumbFile(file: File | null) {
    if (!file) {
      updateProject({ thumbnailDataUrl: undefined })
      return
    }
    if (file.size > 1_500_000) {
      window.alert('For this demo, use an image under ~1.5MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      updateProject({ thumbnailDataUrl: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  function formatRecScore100(n: number | undefined) {
    return `${Math.min(100, Math.max(0, Math.round(n ?? 0)))} / 100`
  }

  function addTagToViewer(tag: string) {
    const t = tag.trim()
    if (!t) return
    const cur = proj.viewerTags ?? []
    if (cur.some((x) => x.toLowerCase() === t.toLowerCase())) return
    updateProject({ viewerTags: [...cur, t] })
  }

  function renderModel2TitleBlock() {
    return (
      <div className="surface-3d-inset border-emerald-200/90 bg-emerald-50/95 p-4 dark:border-emerald-900 dark:bg-emerald-950/50">
        <h2 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
          Title Confidence
        </h2>
        <p className="mt-1 text-xs text-emerald-900/85 dark:text-emerald-200/90">
          Updates as you edit your title.
        </p>
        {m2Loading ? (
          <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300">
            Scoring…
          </p>
        ) : null}
        {proj.titleConfidenceScore != null && !m2Loading ? (
          <p className="mt-3 text-sm font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
            {proj.titleConfidenceScore.toFixed(0)} / 100
          </p>
        ) : !m2Loading &&
          (proj.title?.trim() ?? '') &&
          proj.youtubeCategoryId != null ? null : (
          <p className="mt-2 text-xs text-zinc-500">
            {!proj.title?.trim()
              ? 'Enter a title.'
              : 'Choose a category on Input.'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 drop-shadow-sm dark:text-zinc-50">
        Video Basic Info
      </h1>
      <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
        Your metadata, scores, and model suggestions in one focused layout.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,480px)] lg:items-start">
        <div className="space-y-5">
          <div className="surface-3d overflow-hidden border-zinc-800/15 bg-black transition-transform hover:scale-[1.01] dark:border-zinc-600/40">
            {previewUrl &&
            project.transcript != null &&
            project.transcript !== '' ? (
              <video
                src={previewUrl}
                controls
                className={clsx(thumbAspect, 'w-full')}
              />
            ) : (
              <div
                className={clsx(
                  'flex items-center justify-center bg-zinc-900 px-4 text-center text-sm text-zinc-500',
                  thumbAspect,
                )}
              >
                {previewUrl
                  ? 'Complete analysis on the Input step to unlock video preview.'
                  : 'No video preview (upload on Input page)'}
              </div>
            )}
          </div>

          <div
            data-vb-keep-focus
            className={clsx(
              'vb-field-panel cursor-pointer',
              titleEdited && 'vb-field-panel--edited',
              recTarget === 'title' && 'vb-field-panel--selected',
            )}
            onClick={() => activateRec('title')}
          >
            <label className="block text-base font-semibold text-black dark:text-zinc-100">
              Title
            </label>
            <input
              type="text"
              value={project.title ?? ''}
              onFocus={() => {
                activateRec('title')
              }}
              onChange={(e) => updateProject({ title: e.target.value })}
              className="input-field mt-2 bg-white text-black dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="Catchy title"
            />
            {project.youtubeCategoryId == null ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                Choose a YouTube category on Input for title scoring.
              </p>
            ) : null}
          </div>

          <div
            data-vb-keep-focus
            className={clsx(
              'vb-field-panel cursor-pointer',
              tagsEdited && 'vb-field-panel--edited',
              recTarget === 'tags' && 'vb-field-panel--selected',
            )}
            onClick={() => activateRec('tags')}
          >
            <label
              htmlFor="vb-viewer-tags"
              className="block text-base font-semibold text-black dark:text-zinc-100"
            >
              Viewer Tags
            </label>
            <div className="mt-2" onFocusCapture={() => activateRec('tags')}>
              <TagChipInput
                id="vb-viewer-tags"
                tags={project.viewerTags ?? []}
                onChange={(tags) => updateProject({ viewerTags: tags })}
                placeholder="Type a tag, Space or Enter"
                className="w-full"
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Space or Enter adds a tag; Backspace removes the last when empty.
              The first tag is highlighted when this panel is open.
            </p>
          </div>

          <div
            data-vb-keep-focus
            className={clsx(
              'vb-field-panel cursor-pointer',
              descEdited && 'vb-field-panel--edited',
              recTarget === 'description' && 'vb-field-panel--selected',
            )}
            onClick={() => activateRec('description')}
          >
            <label className="block text-base font-semibold text-black dark:text-zinc-100">
              Description
            </label>
            <textarea
              value={project.description ?? ''}
              onFocus={() => {
                activateRec('description')
              }}
              onChange={(e) => updateProject({ description: e.target.value })}
              rows={4}
              className="input-field mt-2 min-h-[7rem] text-black dark:text-zinc-100"
              placeholder="What viewers get from this video"
            />
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Open this panel for description suggestions based on your script and
              summary.
            </p>
          </div>

          <div
            data-vb-keep-focus
            className={clsx(
              'vb-field-panel cursor-pointer outline-none',
              thumbEdited && 'vb-field-panel--edited',
              recTarget === 'thumbnailGen' && 'vb-field-panel--selected',
            )}
            tabIndex={0}
            onFocus={() => {
              activateRec('thumbnailGen')
            }}
            onClick={() => {
              activateRec('thumbnailGen')
            }}
          >
            <label className="block text-base font-semibold text-black dark:text-zinc-100">
              Thumbnail
            </label>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Generate or upload a thumbnail. Uses your title and summary.
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onThumbFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full cursor-pointer text-sm text-zinc-600 file:mr-4 file:cursor-pointer file:rounded-xl file:border-2 file:border-zinc-300 file:bg-zinc-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-zinc-800 hover:file:border-orange-400 hover:file:bg-orange-50 dark:text-zinc-400 dark:file:border-zinc-600 dark:file:bg-zinc-800 dark:file:text-zinc-100 dark:hover:file:border-orange-600 dark:hover:file:bg-orange-950/40"
            />
            {project.thumbnailDataUrl && (
              <img
                src={project.thumbnailDataUrl}
                alt=""
                className={clsx(
                  'mt-3 w-full max-h-[min(360px,50vh)] rounded-xl border-2 border-zinc-300 object-cover dark:border-zinc-600',
                  thumbAspect,
                )}
              />
            )}
            {m4ThumbLoading && project.thumbnailDataUrl ? (
              <p className="mt-2 text-xs text-zinc-500">Updating thumbnail score…</p>
            ) : null}
          </div>

        </div>

        <div className="flex flex-col gap-4" data-vb-keep-focus>
          <aside className="surface-3d border-orange-300/70 bg-gradient-to-br from-white via-orange-50/40 to-orange-50/30 p-4 dark:border-orange-800 dark:from-zinc-900 dark:via-orange-950/25 dark:to-orange-950/15">
            <p className="text-xs font-medium uppercase tracking-wide text-orange-600 dark:text-orange-400">
              Overall Score
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
              {heuristicTotal}
              <span className="text-lg font-normal text-zinc-500"> / 100</span>
            </p>
            <div className="mt-4 border-t border-orange-200/80 pt-3 dark:border-orange-800/80">
              <p className="text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-400">
                Thumbnail
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                {project.model4ThumbnailScore != null ? (
                  <>
                    {project.model4ThumbnailScore.toFixed(0)}
                    <span className="text-base font-normal text-zinc-500"> / 100</span>
                  </>
                ) : m4ThumbLoading ? (
                  <span className="text-base font-normal text-zinc-500">Scoring…</span>
                ) : (
                  <span className="text-base font-normal text-zinc-500">—</span>
                )}
              </p>
            </div>
          </aside>

          <aside className="relative flex min-h-[62vh] flex-col rounded-2xl border-2 border-orange-400/70 bg-gradient-to-b from-white via-orange-50/25 to-orange-50/35 p-1 shadow-[6px_6px_0_0_rgba(234,88,12,0.22)] dark:border-orange-700 dark:from-zinc-900 dark:via-orange-950/20 dark:to-orange-950/15">
            <div className="relative min-h-0 flex-1 p-3">
              <div>
                {recTarget === 'none' ? (
                  <div className="flex min-h-[52vh] flex-col items-center justify-center px-4 text-center">
                    <p className="text-2xl font-semibold text-orange-900 dark:text-orange-200">
                      Select a Section
                    </p>
                    <p className="mt-4 max-w-sm text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                      Click <strong>Title</strong>, <strong>Viewer Tags</strong>,{' '}
                      <strong>Description</strong>, or <strong>Thumbnail</strong> on the
                      left to see suggestions here.
                    </p>
                  </div>
                ) : panelLoading ? (
                  <div className="flex min-h-[52vh] flex-col items-center justify-center px-4 text-center">
                    <span
                      className="inline-block h-10 w-10 animate-spin rounded-full border-[3px] border-orange-400 border-t-transparent dark:border-orange-500 dark:border-t-transparent"
                      aria-hidden
                    />
                    <p className="mt-5 text-base font-medium text-orange-800 dark:text-orange-200">
                      Loading recommendations…
                    </p>
                    <p className="mt-2 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
                      Suggestions load in a moment.
                    </p>
                  </div>
                ) : (
                  <>
                    {delayedRecTarget === 'title' ? (
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Title Recommendations
                    </p>
                    {renderModel2TitleBlock()}
                    <div className="surface-3d border-amber-300/90 bg-amber-50/90 p-4 dark:border-amber-800 dark:bg-amber-950/40">
                      <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                        Suggested Titles
                      </p>
                      <p className="mt-1 text-xs text-amber-900/85 dark:text-amber-200/90">
                        Pick a line to use as your title.
                      </p>
                      <button
                        type="button"
                        disabled={m3Loading}
                        onClick={() => void runModel3Recommendations()}
                        className="btn-3d mt-4 w-full border-amber-600 bg-amber-500 py-2.5 text-sm text-white hover:bg-amber-400 disabled:opacity-50 dark:border-amber-500"
                      >
                        {m3Loading ? 'Generating…' : 'Generate Title Ideas'}
                      </button>
                      {m3Error ? (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {m3Error}
                        </p>
                      ) : null}
                      {project.model3TitleRecommendations &&
                      project.model3TitleRecommendations.length > 0 ? (
                        <div className="mt-4 border-t border-amber-300/70 pt-4 dark:border-amber-800 flex flex-col gap-2">
                          {project.model3TitleRecommendations.map((row, i) => (
                            <button
                              key={`${row.title}-${i}`}
                              type="button"
                              onClick={() => updateProject({ title: row.title })}
                              className="btn-3d flex w-full items-start justify-between gap-3 border-amber-200 bg-white px-3 py-2.5 text-left text-sm hover:border-amber-400 hover:bg-amber-50/80 dark:border-amber-900 dark:bg-zinc-900 dark:hover:bg-amber-950/40"
                            >
                              <span className="min-w-0 font-medium text-zinc-900 dark:text-zinc-100">
                                {row.title}
                              </span>
                              <span className="shrink-0 tabular-nums text-xs font-semibold text-amber-800 dark:text-amber-300">
                                {formatRecScore100(row.score)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                    {delayedRecTarget === 'tags' ? (
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-orange-700 dark:text-orange-400">
                      Tag Recommendations
                    </p>
                    <div className="surface-3d-inset border-orange-300/90 bg-orange-50/90 p-4 dark:border-orange-900 dark:bg-orange-950/35">
                      <h2 className="text-sm font-semibold text-orange-950 dark:text-orange-100">
                        First Tag
                      </h2>
                      <p className="mt-1 text-xs text-orange-900/85 dark:text-orange-200/90">
                        Based on your first viewer tag.
                      </p>
                      {!primaryViewerTag ? (
                        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                          Add at least one viewer tag on the left.
                        </p>
                      ) : tag2Loading ? (
                        <p className="mt-3 text-xs text-orange-800 dark:text-orange-300">
                          Scoring tag…
                        </p>
                      ) : tag2Score != null && tag2Breakdown ? (
                        <div className="mt-3 text-sm">
                          <p className="font-semibold text-orange-900 dark:text-orange-200">
                            “{primaryViewerTag}” — {tag2Score.toFixed(0)} / 100
                          </p>
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-zinc-500">
                          Add a transcript and category on Input to enable this.
                        </p>
                      )}
                    </div>

                    <div className="surface-3d border-orange-300/90 bg-orange-50/80 p-4 dark:border-orange-900 dark:bg-orange-950/30">
                      <p className="text-sm font-semibold text-orange-950 dark:text-orange-100">
                        More Tag Ideas
                      </p>
                      <p className="mt-1 text-xs text-orange-900/85 dark:text-orange-200/90">
                        Tap a row to add it to viewer tags.
                      </p>
                      <button
                        type="button"
                        disabled={m3TagsLoading}
                        onClick={() => void runModel3Tags()}
                        className="btn-3d mt-4 w-full border-orange-600 bg-orange-600 py-2.5 text-sm text-white hover:bg-orange-500 disabled:opacity-50 dark:border-orange-500"
                      >
                        {m3TagsLoading ? 'Generating…' : 'Generate More Tags'}
                      </button>
                      {m3TagsError ? (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {m3TagsError}
                        </p>
                      ) : null}
                      {project.model3TagRecommendations &&
                      project.model3TagRecommendations.length > 0 ? (
                        <div className="mt-3 flex flex-col gap-2">
                          {project.model3TagRecommendations.map((row, i) => (
                            <button
                              key={`${row.tag}-${i}`}
                              type="button"
                              onClick={() => addTagToViewer(row.tag)}
                              className="btn-3d flex w-full items-center justify-between gap-3 border-orange-200 bg-white px-3 py-2.5 text-left text-sm hover:border-orange-400 hover:bg-orange-50/80 dark:border-orange-900 dark:bg-zinc-900 dark:hover:bg-orange-950/30"
                            >
                              <span className="min-w-0 font-medium text-zinc-900 dark:text-zinc-100">
                                {row.tag}
                              </span>
                              <span className="shrink-0 tabular-nums text-xs font-semibold text-orange-800 dark:text-orange-300">
                                {formatRecScore100(row.score)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                    {delayedRecTarget === 'description' ? (
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                      Description Recommendations
                    </p>
                    <div className="surface-3d border-sky-300/90 bg-sky-50/90 p-4 dark:border-sky-900 dark:bg-sky-950/35">
                      <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">
                        Suggested Copy
                      </p>
                      <p className="mt-1 text-xs text-sky-900/85 dark:text-sky-200/90">
                        Based on your transcript and summary. Tap a line to use it.
                      </p>
                      <button
                        type="button"
                        disabled={m3DescLoading}
                        onClick={() => void runModel3Descriptions()}
                        className="btn-3d mt-4 w-full border-sky-600 bg-sky-600 py-2.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50 dark:border-sky-500"
                      >
                        {m3DescLoading ? 'Generating…' : 'Generate Descriptions'}
                      </button>
                      {m3DescError ? (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {m3DescError}
                        </p>
                      ) : null}
                      {project.model3DescriptionRecommendations &&
                      project.model3DescriptionRecommendations.length > 0 ? (
                        <div className="mt-3 flex flex-col gap-2">
                          {project.model3DescriptionRecommendations.map((row, i) => (
                            <button
                              key={`${row.text.slice(0, 24)}-${i}`}
                              type="button"
                              onClick={() => updateProject({ description: row.text })}
                              className="btn-3d flex w-full items-start justify-between gap-3 border-sky-200 bg-white px-3 py-2.5 text-left text-sm hover:border-sky-400 hover:bg-sky-50/80 dark:border-sky-900 dark:bg-zinc-900 dark:hover:bg-sky-950/30"
                            >
                              <span className="min-w-0 text-zinc-900 dark:text-zinc-100">
                                {row.text}
                              </span>
                              <span className="shrink-0 self-start tabular-nums text-xs font-semibold text-sky-800 dark:text-sky-300">
                                {formatRecScore100(row.score)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                    {delayedRecTarget === 'thumbnailGen' ? (
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-400">
                      Thumbnail Generation
                    </p>
                    <div className="surface-3d border-teal-300/90 bg-teal-50/90 p-4 dark:border-teal-900 dark:bg-teal-950/35">
                      <p className="text-sm font-semibold text-teal-950 dark:text-teal-100">
                        AI Thumbnail
                      </p>
                      <p className="mt-1 text-xs text-teal-900/85 dark:text-teal-200/90">
                        Creates an image from your title and summary. Previews stay in this
                        session only.
                      </p>
                      <button
                        type="button"
                        disabled={
                          thumbGenLoading ||
                          (!(proj.title ?? '').trim() &&
                            !(proj.aiContentSummary ?? '').trim())
                        }
                        onClick={() => void runThumbnailGeneration()}
                        className="btn-3d mt-4 w-full border-teal-600 bg-teal-600 py-2.5 text-sm text-white hover:bg-teal-500 disabled:opacity-50 dark:border-teal-500"
                      >
                        {thumbGenLoading ? 'Generating…' : 'Generate Thumbnail'}
                      </button>
                      {thumbGenError ? (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {thumbGenError}
                        </p>
                      ) : null}
                      {thumbGenSlots.length > 0 ? (
                        <div className="mt-4 flex flex-col gap-4">
                          {thumbGenSlots.map((slot, i) => (
                            <div
                              key={`thumb-slot-${i}-${slot === 'loading' ? 's' : slot.dataUrl.slice(0, 24)}`}
                              className="thumb-gen-card overflow-hidden rounded-xl border border-teal-200/90 bg-white dark:border-teal-900 dark:bg-zinc-900"
                              style={{
                                animationDelay: `${i * 120}ms`,
                              }}
                            >
                              {slot === 'loading' ? (
                                <div className="space-y-2 p-2">
                                  <div
                                    className={clsx(
                                      'w-full animate-pulse rounded-lg bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 dark:from-zinc-800 dark:via-zinc-700 dark:to-zinc-800',
                                      thumbAspect,
                                    )}
                                  />
                                  <div className="h-9 w-full animate-pulse rounded-lg bg-zinc-200/90 dark:bg-zinc-800" />
                                </div>
                              ) : (
                                <>
                                  <div className="relative">
                                    <img
                                      src={slot.dataUrl}
                                      alt=""
                                      className={clsx(
                                        'w-full object-cover',
                                        thumbAspect,
                                      )}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    disabled={thumbApplyLoading}
                                    onClick={() => void applyGeneratedThumbnail(slot)}
                                    className="btn-3d w-full border-teal-500/80 bg-teal-100/90 py-2 text-sm text-teal-950 hover:bg-teal-200/90 disabled:opacity-60 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-100 dark:hover:bg-teal-900/40"
                                  >
                                    {thumbApplyLoading
                                      ? 'Scoring & applying…'
                                      : 'Apply as thumbnail'}
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                  </>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
