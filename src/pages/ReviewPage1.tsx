import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProject } from '../hooks/useProject'
import { useVideoPreview } from '../hooks/useVideoPreview'
import clsx from 'clsx'

function DeviceFrame({
  label,
  variant,
  children,
}: {
  label: string
  variant: 'mobile' | 'desktop' | 'tv'
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[260px] min-w-0 flex-1 flex-col items-center justify-center gap-3 sm:gap-4">
      <span className="text-center text-sm font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {variant === 'mobile' && (
        <div className="flex w-full flex-col items-center justify-center">
          <div
            className={clsx(
              'relative overflow-hidden rounded-[1.35rem] border-[8px] border-zinc-800 bg-zinc-900 shadow-lg',
              'h-[168px] w-[94px]',
              'dark:border-zinc-950',
            )}
          >
            <div className="absolute left-1/2 top-1.5 z-10 h-3 w-14 -translate-x-1/2 rounded-full bg-zinc-950/90" />
            <div className="relative h-full w-full overflow-hidden rounded-[0.85rem] bg-black pt-5">
              {children}
            </div>
            <div className="absolute bottom-1 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-zinc-700/80" />
          </div>
        </div>
      )}
      {variant === 'desktop' && (
        <div className="flex w-full max-w-[280px] flex-col items-center">
          <div className="w-full rounded-t-md border-x border-t border-zinc-400 bg-zinc-300 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-zinc-400/80 dark:bg-zinc-600" />
          </div>
          <div
            className={clsx(
              'relative h-[146px] w-[260px] overflow-hidden rounded-b-md border-2 border-zinc-400 bg-zinc-200 shadow-md',
              'dark:border-zinc-600 dark:bg-zinc-900',
            )}
          >
            {children}
          </div>
          <div className="mt-1.5 h-1.5 w-16 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>
      )}
      {variant === 'tv' && (
        <div className="flex w-full max-w-[320px] flex-col items-center">
          <div
            className={clsx(
              'relative h-[180px] w-[300px] overflow-hidden rounded-md border-[12px] border-zinc-800 bg-zinc-950 shadow-xl',
              'dark:border-zinc-900',
            )}
          >
            <div className="absolute inset-x-5 top-2 z-10 h-0.5 rounded-full bg-zinc-700/60" />
            <div className="relative h-full w-full overflow-hidden bg-black">
              {children}
            </div>
          </div>
          <div className="mt-2 flex h-7 w-36 items-center justify-center rounded-md bg-zinc-800 shadow-inner dark:bg-zinc-950">
            <span className="h-1 w-7 rounded-full bg-zinc-600" />
          </div>
        </div>
      )}
    </div>
  )
}

export function ReviewPage1() {
  const { id } = useParams<{ id: string }>()
  const { project, updateProject } = useProject(id)
  const { previewUrl } = useVideoPreview(id)

  if (!id || !project) {
    return (
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Project not found. <Link to="/">Back to dashboard</Link>
      </p>
    )
  }

  const thumb = project.thumbnailDataUrl

  const preview = previewUrl ? (
    <video src={previewUrl} muted playsInline className="h-full w-full object-cover" />
  ) : thumb ? (
    <img src={thumb} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-xs text-zinc-500">
      No media
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-7xl px-2 sm:px-4 lg:px-8">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 lg:text-4xl">
        Review — devices
      </h1>
      <p className="mt-3 max-w-3xl text-base text-zinc-600 dark:text-zinc-400 lg:text-lg">
        Cross-device preview of how your packshot and motion read before publish.
      </p>

      <div className="mt-10 flex flex-col items-center justify-center gap-12 lg:flex-row lg:items-center lg:justify-center">
        <div className="flex flex-col items-center gap-10 sm:flex-row sm:items-center sm:justify-center sm:gap-6 lg:gap-5">
          <div className="-translate-x-3 sm:-translate-x-5 lg:-translate-x-8">
            <DeviceFrame label="Phone" variant="mobile">
              {preview}
            </DeviceFrame>
          </div>
          <DeviceFrame label="Desktop" variant="desktop">
            {preview}
          </DeviceFrame>
        </div>
        <div className="lg:ml-10 xl:ml-16">
          <DeviceFrame label="TV" variant="tv">
            {preview}
          </DeviceFrame>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-4xl">
        <div className="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:gap-12">
          <div>
            <label htmlFor="audience" className="label-lg block">
              Audience
            </label>
            <select
              id="audience"
              value={project.audienceKind ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'madeForKids' || v === 'notMadeForKids') {
                  updateProject({ audienceKind: v })
                } else {
                  updateProject({ audienceKind: undefined })
                }
              }}
              className="input-field mt-3 text-zinc-900 dark:text-zinc-100"
            >
              <option value="" className="text-zinc-500">
                Select…
              </option>
              <option value="madeForKids">Made for kids (family-friendly)</option>
              <option value="notMadeForKids">Not made for kids (general / 18+)</option>
            </select>
          </div>
          <div>
            <span className="label-lg block">Visibility</span>
            <div className="mt-3 flex flex-wrap gap-6">
              {(['public', 'unlisted'] as const).map((v) => (
                <label key={v} className="flex items-center gap-3 text-base">
                  <input
                    type="radio"
                    name="visibility"
                    checked={(project.visibility ?? 'public') === v}
                    onChange={() => updateProject({ visibility: v })}
                    className="accent-orange-600"
                  />
                  {v === 'public' ? 'Public' : 'Unlisted'}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
