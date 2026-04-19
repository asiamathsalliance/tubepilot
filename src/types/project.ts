export type ProjectStatus = 'draft' | 'published'

export type LastEditedStep =
  | 'input'
  | 'video-info'
  | 'end-screen'
  | 'editor'
  | 'review-1'
  | 'review-2'

export type VideoLength = 'long' | 'short'

export type EngagementLevel = 'high' | 'low'

export interface TimelineSegment {
  /** Stable id for drag, context menu, and clip-farm queue. */
  id?: string
  start: number
  end: number
  engagement: EngagementLevel
}

export interface ClipItem {
  id: string
  score: number
  sourceSegmentIndex: number
  label: string
  /** Source time range in the original video (seconds). */
  startSec?: number
  endSec?: number
}

/** Serialized clip-farm entry (no embedded preview blob). */
export interface ClipFarmQueueEntry {
  id: string
  segmentId: string
  label: string
  startSec: number
  endSec: number
  engagement?: EngagementLevel
}

/** Draggable end-card layout: app logo (circle) + exactly two project link rectangles. */
export interface EndScreenRectSlot {
  left: number
  top: number
  width: number
  height: number
  /** Another ClipFarm project to promote in this slot. */
  linkedProjectId?: string
}

export interface EndScreenLayout {
  layoutVersion: 2
  /**
   * App logo: center position (0–100% of frame) + width as % of frame width.
   * Rendered as `aspect-square` + `translate(-50%,-50%)` so it stays a true circle on 16:9.
   */
  logo: { cx: number; cy: number; size: number }
  rects: [EndScreenRectSlot, EndScreenRectSlot]
  /** Which control is selected for the project picker (rectangles only). */
  activeSlot: 'r0' | 'r1' | 'logo' | null
}

export interface Project {
  id: string
  name: string
  createdAt: string
  status: ProjectStatus
  lastEditedStep: LastEditedStep
  publishedAt?: string

  videoLength?: VideoLength
  niche?: string
  /** @deprecated prefer youtubeCategoryId */
  category?: string
  /** YouTube category_id (see YOUTUBE_CATEGORIES). */
  youtubeCategoryId?: number
  /** Viewer / SEO tags used for Model 2 alignment. */
  viewerTags?: string[]
  /** Region code for Model 2 (matches Kaggle file prefixes, e.g. US, GLOBAL). */
  trendingRegion?: string
  videoFileMeta?: { name: string; size: number; type: string }

  title?: string
  description?: string
  /**
   * Full image data URL for Model 4 scoring and UI. Stored in **sessionStorage** per
   * project id (not in `localStorage`) to avoid quota errors; rehydrated on load.
   */
  thumbnailDataUrl?: string

  /**
   * Not persisted — thumbnail panel uses in-memory state only.
   * @deprecated Kept for typing only; do not save via updateProject.
   */
  thumbnailGenerations?: {
    id: string
    dataUrl: string
    score: number
    createdAt: string
  }[]

  /** Full transcript from Whisper (English); stored when user runs analysis on Video basic info. */
  transcript?: string
  /** Title ideas from local Ollama (e.g. DeepSeek) based on transcript. */
  aiTitleSuggestions?: string[]
  /** Short Ollama summary of video content from transcript. */
  aiContentSummary?: string

  /** Model 2 — Kaggle-derived title confidence (0–100). */
  titleConfidenceScore?: number
  titleConfidenceBreakdown?: {
    tagAndCategoryScore: number
    trendingLexicalSimilarity: number
    titleLengthScore: number
    languageStructureScore: number
    notes: string[]
  }

  /** Model 3 — LLM candidates scored by Model 2; top 5 highest → lowest. */
  model3TitleRecommendations?: {
    title: string
    score: number
    breakdown?: {
      tagAndCategoryScore: number
      trendingLexicalSimilarity: number
      titleLengthScore: number
      languageStructureScore: number
      notes: string[]
    }
  }[]

  /** Last Model 3 API run stats (for UI). */
  model3LastRun?: {
    candidateCount: number
    datasetExamplesUsed: number
  }

  /** Model 3 — tag candidates scored by Model 2_Tag (dataset); top picks. */
  model3TagRecommendations?: {
    tag: string
    score: number
    breakdown?: {
      tagAndCategoryScore: number
      trendingLexicalSimilarity: number
      titleLengthScore: number
      languageStructureScore: number
      notes: string[]
    }
  }[]

  model3TagsLastRun?: {
    candidateCount: number
    datasetTagsUsed: number
  }

  /** Model 3 — description variants (transcript overlap score). */
  model3DescriptionRecommendations?: {
    text: string
    score: number
  }[]

  model3DescriptionsLastRun?: {
    datasetTrendUsed: boolean
  }

  /** Model 4 — thumbnail vs dataset feature calibration (YOLO + CNN + text-band heuristics). */
  model4ThumbnailScore?: number
  model4ThumbnailBreakdown?: {
    typicalityVsDataset: number
    textBandVsDataset: number
    textBandProxy: number
    yoloWorldTextAreaRatio?: number
    yoloWorldTextBoxCountNorm?: number
    yoloWorldTextCenterY?: number
    yoloWorldTextBottomZoneFrac?: number
    yoloPersonsApprox: number
    yoloMaxBoxAreaRatio: number
    colorSaturationMean: number
    edgeDensityBottomThird: number
    heuristicTextBandBottom?: number
    textVisibilityPenalty?: number
  }
  model4LastRunNote?: string

  endScreen?: EndScreenLayout

  /** Model 5/6 excitement run metadata (small JSON; segments stay in timelineSegments). */
  excitementAnalysisMeta?: {
    windowSec: number
    weights: { w1: number; w2: number; w3: number }
    analyzedAt: string
    capped?: boolean
    fullDurationSec?: number
  }

  /**
   * Model 8 — recommended publish time per timeline region (heuristic aligned with
   * model8 publish_hour / publish_dow features; see server/recommendUploadDatesModel8.js).
   */
  model8UploadRecommendations?: {
    segmentId: string
    recommendedAt: string
    note: string
    score100?: number
    estimatedViews?: number
  }[]

  /** Clip farm queue (metadata only; preview frames live in sessionStorage). */
  clipFarmQueue?: ClipFarmQueueEntry[]

  timelineSegments?: TimelineSegment[]
  totalDurationSec?: number
  clips?: ClipItem[]
  selectedClipIds?: string[]

  audience?: string
  visibility?: 'public' | 'unlisted'

  publishDate?: string

  /** Set after a successful YouTube scheduled upload (Data API). */
  youtubeScheduledVideoId?: string
  youtubeScheduledUrl?: string

  /** Per-asset scheduled uploads (`main` or clip-farm entry id). */
  youtubeScheduledByAssetId?: Record<
    string,
    { videoId: string; url: string; atIso?: string }
  >

  /**
   * Review 2 — per-asset upload plan (`main` or clip-farm entry id): suggested time + Model 8 scores.
   */
  uploadPlanByAssetId?: Record<
    string,
    { atIso: string; score100?: number; estimatedViews?: number }
  >
}
