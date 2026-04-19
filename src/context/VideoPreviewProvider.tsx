import { useCallback, useRef, useState, type ReactNode } from 'react'
import { VideoPreviewContext } from './videoPreviewContext'

export function VideoPreviewProvider({ children }: { children: ReactNode }) {
  const urlMapRef = useRef<Map<string, string>>(new Map())
  const fileMapRef = useRef<Map<string, File>>(new Map())
  const [, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const setFile = useCallback((projectId: string, file: File | null) => {
    const prev = urlMapRef.current.get(projectId)
    if (prev) URL.revokeObjectURL(prev)
    if (!file) {
      urlMapRef.current.delete(projectId)
      fileMapRef.current.delete(projectId)
    } else {
      urlMapRef.current.set(projectId, URL.createObjectURL(file))
      fileMapRef.current.set(projectId, file)
    }
    bump()
  }, [])

  const getUrl = useCallback((projectId: string) => {
    return urlMapRef.current.get(projectId)
  }, [])

  const getFile = useCallback((projectId: string) => {
    return fileMapRef.current.get(projectId)
  }, [])

  return (
    <VideoPreviewContext.Provider value={{ getUrl, getFile, setFile }}>
      {children}
    </VideoPreviewContext.Provider>
  )
}
