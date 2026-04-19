import { createContext } from 'react'

export type VideoPreviewContextValue = {
  getUrl: (projectId: string) => string | undefined
  getFile: (projectId: string) => File | undefined
  setFile: (projectId: string, file: File | null) => void
}

export const VideoPreviewContext =
  createContext<VideoPreviewContextValue | null>(null)
