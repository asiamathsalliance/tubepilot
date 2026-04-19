import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  src: string
  className?: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  onLoadedMetadata?: () => void
  onTimeUpdate?: () => void
}

export function VideoPlayerYoutubeLike({
  src,
  className = '',
  videoRef,
  onLoadedMetadata,
  onTimeUpdate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [videoRef, src])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }, [videoRef])

  const requestFs = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen().catch(() => {})
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative aspect-video w-full overflow-hidden bg-black ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        className="h-full w-full object-contain"
        playsInline
        controls={false}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onClick={togglePlay}
      />
      {!playing ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/35 transition hover:bg-black/45"
          aria-label="Play"
        >
          <span className="flex h-[72px] w-[104px] items-center justify-center rounded-lg bg-black/55 pl-2 shadow-lg ring-2 ring-white/90">
            <svg
              viewBox="0 0 24 24"
              className="h-14 w-14 text-white"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          requestFs()
        }}
        className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/75"
        aria-label="Fullscreen"
      >
        Full screen
      </button>
    </div>
  )
}
