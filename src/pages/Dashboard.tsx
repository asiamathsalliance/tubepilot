import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProjectsList } from '../hooks/useProject'
import { projectStepPath } from '../lib/routes'
import { deleteProjectById } from '../lib/storage'
import type { Project } from '../types/project'
import clsx from 'clsx'

function DotsVerticalIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

type SortOrder = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
]

function sortProjects(list: Project[], order: SortOrder): Project[] {
  const copy = [...list]
  switch (order) {
    case 'date-desc':
      return copy.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    case 'date-asc':
      return copy.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
    case 'name-asc':
      return copy.sort((a, b) => a.name.localeCompare(b.name))
    case 'name-desc':
      return copy.sort((a, b) => b.name.localeCompare(a.name))
    default:
      return copy
  }
}

export function Dashboard() {
  const projects = useProjectsList()
  const navigate = useNavigate()
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('date-desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [displayName, setDisplayName] = useState('User')
  const menuRootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const v = localStorage.getItem('tubepilot-display-name')
      if (v?.trim()) setDisplayName(v.trim())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (openMenuId === null) return
    const close = (e: MouseEvent) => {
      const el = menuRootRef.current
      if (el && !el.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuId])

  const sorted = useMemo(
    () => sortProjects(projects, sortOrder),
    [projects, sortOrder],
  )

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((p) => p.name.toLowerCase().includes(q))
  }, [sorted, searchQuery])

  return (
    <div className="w-full">
      <section className="w-full border-b border-zinc-200 bg-gradient-to-br from-zinc-100 via-white to-orange-50/40 px-4 py-8 pl-10 sm:px-6 sm:pl-16 lg:px-10 lg:py-10 lg:pl-28 xl:pl-36 dark:border-zinc-800 dark:from-zinc-900 dark:via-zinc-950 dark:to-orange-950/20">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          Welcome Back, {displayName}!
        </h2>
        <p className="mt-2 max-w-xl text-base text-zinc-600 dark:text-zinc-400">
          Pick up where you left off or start something new. Your projects and
          workflow are below.
        </p>
      </section>

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-0">
          <aside className="w-full shrink-0 lg:w-56 lg:pr-8">
            <label
              htmlFor="dashboard-project-search"
              className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              Search
            </label>
            <input
              id="dashboard-project-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name…"
              autoComplete="off"
              className="input-field mt-2 text-sm"
            />
            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Sort & order
            </h3>
            <div className="mt-3 flex flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-50/80 p-2 dark:border-zinc-700 dark:bg-zinc-900/50">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSortOrder(opt.value)}
                  className={clsx(
                    'rounded-lg px-3 py-2.5 text-left text-sm font-medium transition',
                    sortOrder === opt.value
                      ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-orange-300 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-orange-700'
                      : 'text-zinc-600 hover:bg-white/90 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-200',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0 flex-1 border-t border-zinc-200 pt-10 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0 dark:border-zinc-700">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Projects
                </h1>
                <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
                  Open a project to continue where you left off.
                </p>
              </div>
              <Link
                to="/projects/new"
                className="btn-3d-accent inline-flex shrink-0 items-center justify-center px-4 py-2.5 text-sm sm:text-base"
              >
                Start New Project
              </Link>
            </div>

            {sorted.length === 0 ? (
              <div className="surface-3d border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
                <p className="text-zinc-600 dark:text-zinc-400">
                  No projects yet. Create one to begin the workflow.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/projects/new')}
                  className="mt-4 text-sm font-medium text-orange-700 hover:underline dark:text-orange-400"
                >
                  Start New Project
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="surface-3d border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
                <p className="text-zinc-600 dark:text-zinc-400">
                  No projects match &quot;{searchQuery.trim()}&quot;. Try a different
                  search.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="mt-4 text-sm font-medium text-orange-700 hover:underline dark:text-orange-400"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <ul className="space-y-3">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <div className="surface-3d-dashboard-project flex w-full items-stretch justify-between gap-3 px-3 py-3 sm:items-center sm:gap-4 sm:px-4 sm:py-4">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(projectStepPath(p.id, p.lastEditedStep))
                        }
                        className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left transition active:scale-[0.99]"
                      >
                        <p className="font-medium text-zinc-900 dark:text-zinc-50">
                          {p.name}
                        </p>
                        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                          Created {formatDate(p.createdAt)}
                        </p>
                      </button>
                      <div className="flex shrink-0 flex-col items-end justify-center gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <span
                          className={clsx(
                            'order-last rounded-full px-2.5 py-0.5 text-xs font-medium sm:order-none',
                            p.status === 'published'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
                          )}
                        >
                          {p.status === 'published' ? 'Published' : 'Draft'}
                        </span>
                        <div
                          ref={openMenuId === p.id ? menuRootRef : undefined}
                          className="relative flex shrink-0 border-zinc-200 sm:border-l sm:pl-3 dark:border-zinc-600"
                        >
                          <button
                            type="button"
                            aria-label={`Actions for ${p.name}`}
                            aria-expanded={openMenuId === p.id}
                            aria-haspopup="menu"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenMenuId((id) => (id === p.id ? null : p.id))
                            }}
                            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                          >
                            <DotsVerticalIcon className="h-5 w-5" />
                          </button>
                          {openMenuId === p.id ? (
                            <div
                              role="menu"
                              className="absolute right-0 top-full z-20 mt-1 min-w-[10.5rem] rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-orange-50 dark:text-zinc-100 dark:hover:bg-orange-950/35"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  navigate(projectStepPath(p.id, p.lastEditedStep))
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  if (
                                    window.confirm(
                                      `Delete “${p.name}”? This cannot be undone.`,
                                    )
                                  ) {
                                    deleteProjectById(p.id)
                                  }
                                }}
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled
                                title="Coming soon"
                                className="flex w-full cursor-not-allowed px-3 py-2 text-left text-sm text-zinc-400 dark:text-zinc-500"
                              >
                                Share
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
