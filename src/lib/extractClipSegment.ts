/**
 * Extract a time range to a standalone MP4 via the server (saved under data/raw/clips, then streamed back).
 * Upload this File with scheduleYoutubeUpload — same path as the main video (no server-side trim).
 */
export async function extractClipSegmentToFile(
  video: File,
  trimStartSec: number,
  trimEndSec: number,
): Promise<File> {
  const fd = new FormData()
  fd.append('video', video, video.name)
  fd.append(
    'metadata',
    JSON.stringify({ trimStartSec, trimEndSec }),
  )
  const res = await fetch('/api/video/extract-segment', {
    method: 'POST',
    body: fd,
  })
  const ct = res.headers.get('Content-Type') || ''
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || `Extract failed (${res.status})`)
  }
  if (!ct.includes('video') && !ct.includes('octet-stream')) {
    const text = await res.text().catch(() => '')
    throw new Error(text.slice(0, 200) || 'Unexpected extract response')
  }
  const blob = await res.blob()
  const base = video.name.replace(/\.[^.]+$/i, '') || 'clip'
  return new File([blob], `${base}-segment.mp4`, { type: 'video/mp4' })
}
