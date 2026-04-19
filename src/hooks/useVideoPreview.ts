import { useCallback, useContext } from 'react'
import { VideoPreviewContext } from '../context/videoPreviewContext'

export function useVideoPreview(projectId: string | undefined) {
  const ctx = useContext(VideoPreviewContext)
  if (!ctx) {
    throw new Error('VideoPreviewProvider is required')
  }
  const previewUrl = projectId ? ctx.getUrl(projectId) : undefined
  const videoFile = projectId ? ctx.getFile(projectId) : undefined

  const setVideoFile = useCallback(
    (file: File | null) => {
      if (!projectId) return
      ctx.setFile(projectId, file)
    },
    [ctx, projectId],
  )

  return { previewUrl, videoFile, setVideoFile }
}
