import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProject, useProjectsList } from '../hooks/useProject'
import { projectStepPath } from '../lib/routes'
import type { EndScreenLayout, EndScreenRectSlot, Project } from '../types/project'
import clsx from 'clsx'

/** Logo centered in frame; two cards share vertical center (50% − half height). */
const DEFAULT_END_SCREEN: EndScreenLayout = {
  layoutVersion: 2,
  /** Outer ring (`size`); favicon is scaled down inside so the circle border stays prominent. */
  logo: { cx: 50, cy: 50, size: 17 },
  rects: [
    { left: 5, top: 39, width: 32, height: 22 },
    { left: 63, top: 39, width: 32, height: 22 },
  ],
  activeSlot: null,
}

function migrateLogo(
  raw: EndScreenLayout['logo'] | Record<string, number | undefined>,
): EndScreenLayout['logo'] {
  const o = raw as Record<string, number | undefined>
  if (typeof o.cx === 'number' && typeof o.cy === 'number') {
    return {
      cx: o.cx,
      cy: o.cy,
      size: typeof o.size === 'number' ? o.size : DEFAULT_END_SCREEN.logo.size,
    }
  }
  const left = o.left ?? DEFAULT_END_SCREEN.logo.cx - DEFAULT_END_SCREEN.logo.size / 2
  const top = o.top ?? DEFAULT_END_SCREEN.logo.cy - DEFAULT_END_SCREEN.logo.size / 2
  const size = typeof o.size === 'number' ? o.size : DEFAULT_END_SCREEN.logo.size
  return { cx: left + size / 2, cy: top + size / 2, size }
}

function normalizeEndScreen(raw: Project['endScreen']): EndScreenLayout {
  if (raw?.layoutVersion === 2 && raw.rects?.length === 2) {
    return {
      layoutVersion: 2,
      logo: migrateLogo(raw.logo),
      rects: [
        { ...DEFAULT_END_SCREEN.rects[0], ...raw.rects[0] },
        { ...DEFAULT_END_SCREEN.rects[1], ...raw.rects[1] },
      ],
      activeSlot: raw.activeSlot ?? null,
    }
  }
  return { ...DEFAULT_END_SCREEN }
}

function clampLogo(logo: EndScreenLayout['logo']): EndScreenLayout['logo'] {
  const size = Math.min(40, Math.max(10, logo.size))
  const cx = Math.min(94, Math.max(6, logo.cx))
  const cy = Math.min(94, Math.max(6, logo.cy))
  return { cx, cy, size }
}

function clampRect(r: EndScreenRectSlot): EndScreenRectSlot {
  const width = Math.min(48, Math.max(18, r.width))
  const height = Math.min(48, Math.max(14, r.height))
  const left = Math.min(100 - width, Math.max(0, r.left))
  const top = Math.min(100 - height, Math.max(0, r.top))
  return {
    left,
    top,
    width,
    height,
    linkedProjectId: r.linkedProjectId,
  }
}

function projectLabel(p: Project) {
  const t = (p.title ?? '').trim()
  return t || p.name
}

export function EndScreen() {
  const { id } = useParams<{ id: string }>()
  const { project, updateProject } = useProject(id)
  const allProjects = useProjectsList()

  const [layout, setLayout] = useState<EndScreenLayout>(DEFAULT_END_SCREEN)

  useEffect(() => {
    if (project) setLayout(normalizeEndScreen(project.endScreen))
  }, [project?.id])

  const frameRef = useRef<HTMLDivElement>(null)
  const layoutLive = useRef(layout)
  layoutLive.current = layout

  const dragRef = useRef<{
    kind: 'logo' | 0 | 1
    sx: number
    sy: number
    originLogo: EndScreenLayout['logo']
    originRect: EndScreenRectSlot
  } | null>(null)
  const movedRef = useRef(false)

  if (!id || !project) {
    return (
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Project not found. <Link to="/">Back to dashboard</Link>
      </p>
    )
  }

  const otherProjects = allProjects.filter((p) => p.id !== id)

  function persist(next: EndScreenLayout) {
    layoutLive.current = next
    updateProject({ endScreen: next })
  }

  function bindDragWindow() {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      const el = frameRef.current
      if (!d || !el) return
      const rect = el.getBoundingClientRect()
      const dx = ((e.clientX - d.sx) / rect.width) * 100
      const dy = ((e.clientY - d.sy) / rect.height) * 100
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) movedRef.current = true

      setLayout((prev) => {
        if (d.kind === 'logo') {
          const logo = clampLogo({
            cx: d.originLogo.cx + dx,
            cy: d.originLogo.cy + dy,
            size: d.originLogo.size,
          })
          const next = { ...prev, logo }
          layoutLive.current = next
          return next
        }
        const ri = d.kind
        const nr = clampRect({
          ...d.originRect,
          left: d.originRect.left + dx,
          top: d.originRect.top + dy,
        })
        const rects = [...prev.rects] as EndScreenLayout['rects']
        rects[ri] = { ...nr, linkedProjectId: prev.rects[ri].linkedProjectId }
        const next = { ...prev, rects }
        layoutLive.current = next
        return next
      })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dragRef.current = null
      if (movedRef.current) {
        persist(layoutLive.current)
      }
      movedRef.current = false
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function onLogoPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    movedRef.current = false
    dragRef.current = {
      kind: 'logo',
      sx: e.clientX,
      sy: e.clientY,
      originLogo: { ...layout.logo },
      originRect: layout.rects[0],
    }
    setLayout((prev) => {
      const next = { ...prev, activeSlot: 'logo' as const }
      layoutLive.current = next
      updateProject({ endScreen: next })
      return next
    })
    bindDragWindow()
  }

  function onRectPointerDown(index: 0 | 1, e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    movedRef.current = false
    dragRef.current = {
      kind: index,
      sx: e.clientX,
      sy: e.clientY,
      originLogo: layout.logo,
      originRect: { ...layout.rects[index] },
    }
    setLayout((prev) => {
      const next = {
        ...prev,
        activeSlot: (index === 0 ? 'r0' : 'r1') as 'r0' | 'r1',
      }
      layoutLive.current = next
      updateProject({ endScreen: next })
      return next
    })
    bindDragWindow()
  }

  function assignRect(index: 0 | 1, projectId: string) {
    const rects = [...layout.rects] as EndScreenLayout['rects']
    rects[index] = { ...rects[index], linkedProjectId: projectId }
    const next: EndScreenLayout = {
      ...layout,
      rects,
      activeSlot: index === 0 ? 'r0' : 'r1',
    }
    setLayout(next)
    persist(next)
  }

  function clearRect(index: 0 | 1) {
    const rects = [...layout.rects] as EndScreenLayout['rects']
    rects[index] = { ...rects[index], linkedProjectId: undefined }
    const next: EndScreenLayout = { ...layout, rects }
    setLayout(next)
    persist(next)
  }

  const activeIsRect = layout.activeSlot === 'r0' || layout.activeSlot === 'r1'
  const activeRectIndex: 0 | 1 | null =
    layout.activeSlot === 'r0' ? 0 : layout.activeSlot === 'r1' ? 1 : null

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
        End screen
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Brand mark plus two link tiles you place and bind to any project.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <div
            ref={frameRef}
            className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 ring-1 ring-white/10"
          >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
              16:9 safe area
            </div>

            {/* Linked project rectangles */}
            {([0, 1] as const).map((index) => {
              const r = layout.rects[index]
              const linked = r.linkedProjectId
                ? allProjects.find((p) => p.id === r.linkedProjectId)
                : undefined
              const label = linked ? projectLabel(linked) : 'Empty slot'
              const selected =
                (index === 0 && layout.activeSlot === 'r0') ||
                (index === 1 && layout.activeSlot === 'r1')
              const pathOrPromo =
                linked?.endScreenPromoImage ||
                (linked?.thumbnailDataUrl?.startsWith('/')
                  ? linked.thumbnailDataUrl
                  : undefined)
              const dataThumb =
                linked?.thumbnailDataUrl?.startsWith('data:')
                  ? linked.thumbnailDataUrl
                  : undefined
              const slotImageSrc = pathOrPromo || dataThumb

              return (
                <button
                  key={index}
                  type="button"
                  onPointerDown={(e) => onRectPointerDown(index, e)}
                  style={{
                    left: `${r.left}%`,
                    top: `${r.top}%`,
                    width: `${r.width}%`,
                    height: `${r.height}%`,
                  }}
                  className={clsx(
                    'absolute flex cursor-grab touch-none items-center justify-center overflow-hidden rounded-lg border-2 px-2 text-center shadow-lg transition-[box-shadow,background-color,border-color] duration-200 active:cursor-grabbing',
                    selected
                      ? 'border-orange-400 bg-orange-950/50 shadow-[0_12px_40px_-8px_rgba(234,88,12,0.45)] ring-2 ring-orange-500/40'
                      : 'border-white/35 bg-black/45 hover:border-orange-400/85 hover:bg-black/55 hover:shadow-[0_16px_48px_-12px_rgba(234,88,12,0.5)] hover:shadow-orange-600/40',
                  )}
                >
                  {linked && slotImageSrc ? (
                    <img
                      src={slotImageSrc}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="line-clamp-3 text-sm font-medium leading-tight text-white">
                      {label}
                    </span>
                  )}
                </button>
              )
            })}

            {/* App logo — true circle (square by width + aspect-square) centered on cx/cy */}
            <div
              role="presentation"
              onPointerDown={onLogoPointerDown}
              style={{
                left: `${layout.logo.cx}%`,
                top: `${layout.logo.cy}%`,
                width: `${layout.logo.size}%`,
                aspectRatio: '1',
                height: 'auto',
                transform: 'translate(-50%, -50%)',
              }}
              className={clsx(
                'absolute box-border cursor-grab touch-none overflow-hidden rounded-full border-2 bg-zinc-900/90 shadow-xl active:cursor-grabbing',
                layout.activeSlot === 'logo'
                  ? 'border-orange-400 ring-2 ring-orange-500/40'
                  : 'border-white/40',
              )}
            >
              <img
                src="/endscreen/channel-avatar.png"
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Drag elements to reposition; link a project to each slot — the thumbnail
            stays visible in the rectangle.
          </p>
        </div>

        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Link another project
          </h2>
          {!activeIsRect && (
            <p className="mt-2 text-sm text-zinc-500">
              Click one of the two rectangles on the left to select it, then choose a
              project below.
            </p>
          )}
          {activeIsRect && activeRectIndex !== null && (
            <p className="mt-2 text-sm text-orange-600 dark:text-orange-300">
              Slot {activeRectIndex + 1} selected — pick a project.
            </p>
          )}

          <ul className="mt-4 max-h-[min(420px,50vh)] flex-1 space-y-2 overflow-y-auto pr-1">
            {otherProjects.length === 0 && (
              <li className="text-sm text-zinc-500">
                No other projects yet. Create another on the dashboard.
              </li>
            )}
            {otherProjects.map((p) => {
              const linkedId =
                activeRectIndex !== null
                  ? layout.rects[activeRectIndex].linkedProjectId
                  : undefined
              const isLinked = linkedId === p.id
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={!activeIsRect || activeRectIndex === null}
                    onClick={() => {
                      if (activeRectIndex === null) return
                      assignRect(activeRectIndex, p.id)
                    }}
                    className={clsx(
                      'w-full rounded-lg border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50',
                      isLinked
                        ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/30'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600',
                    )}
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {projectLabel(p)}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {p.name}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {activeIsRect && activeRectIndex !== null && layout.rects[activeRectIndex].linkedProjectId && (
            <button
              type="button"
              onClick={() => clearRect(activeRectIndex)}
              className="mt-4 text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Clear slot {activeRectIndex + 1}
            </button>
          )}

          {activeIsRect &&
            activeRectIndex !== null &&
            layout.rects[activeRectIndex].linkedProjectId && (
              <Link
                to={projectStepPath(
                  layout.rects[activeRectIndex].linkedProjectId!,
                  'video-info',
                )}
                className="mt-3 inline-block text-sm font-medium text-orange-600 hover:underline dark:text-orange-400"
              >
                Open linked project →
              </Link>
            )}

        </div>
      </div>
    </div>
  )
}
