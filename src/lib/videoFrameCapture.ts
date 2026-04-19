/**
 * Grab a single frame from a video blob URL (e.g. object URL) for img2img reference.
 */
export async function captureFrameFromVideoUrl(
  videoUrl: string,
  timeRatio = 0.25,
): Promise<Blob> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.src = videoUrl

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Video load failed'))
  })

  const ratio = Math.min(0.92, Math.max(0.05, timeRatio))
  const t = ratio * (video.duration || 0)
  video.currentTime = Number.isFinite(t) && t > 0 ? t : 0

  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('Seek failed'))
  })

  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) {
    throw new Error('Video has no dimensions')
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.drawImage(video, 0, 0, w, h)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('toBlob failed'))
      },
      'image/jpeg',
      0.92,
    )
  })
}
