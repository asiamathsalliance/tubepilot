export type ScheduleYoutubePayload = {
  video: File
  title: string
  description: string
  tags: string[]
  categoryId: number
  /** UTC ISO string (RFC 3339) for YouTube `publishAt`. */
  publishAtIso: string
  isShort: boolean
  thumbnailDataUrl?: string
  /** If set, server trims this range (seconds) from the uploaded file before YouTube insert. */
  trimStartSec?: number
  trimEndSec?: number
}

export async function scheduleYoutubeUpload(
  args: ScheduleYoutubePayload,
): Promise<{ videoId: string; url: string }> {
  const fd = new FormData()
  fd.append('video', args.video, args.video.name)
  fd.append(
    'metadata',
    JSON.stringify({
      title: args.title,
      description: args.description,
      tags: args.tags,
      categoryId: args.categoryId,
      publishAtIso: args.publishAtIso,
      isShort: args.isShort,
      thumbnailDataUrl: args.thumbnailDataUrl,
      ...(args.trimStartSec != null && args.trimEndSec != null
        ? { trimStartSec: args.trimStartSec, trimEndSec: args.trimEndSec }
        : {}),
    }),
  )
  const res = await fetch('/api/youtube/schedule-upload', {
    method: 'POST',
    body: fd,
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    videoId?: string
    url?: string
  }
  if (!res.ok) {
    throw new Error(data.error || `Upload failed (${res.status})`)
  }
  if (!data.videoId || !data.url) {
    throw new Error('Invalid response from server')
  }
  return { videoId: data.videoId, url: data.url }
}
