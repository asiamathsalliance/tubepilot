import type { Project } from '../types/project'

export const STORAGE_KEY = 'clipfarm_projects'

/** One-time replace of local projects with end-screen demo pair (channel + promo thumbs). */
const ENDSCREEN_DEMO_SEED_KEY = 'clipfarm_endscreen_demo_v2'

/** Per-project thumbnail data URL — kept out of localStorage to avoid quota errors. */
const SESSION_THUMB_PREFIX = 'clipfarm_thumb_'

/** Per clip-farm entry preview: `clipfarm_farm_${projectId}_${entryId}` */
const SESSION_FARM_PREFIX = 'clipfarm_farm_'

export function farmPreviewSessionKey(projectId: string, entryId: string) {
  return SESSION_FARM_PREFIX + projectId + '_' + entryId
}

export function setFarmPreviewSession(
  projectId: string,
  entryId: string,
  dataUrl: string | undefined,
) {
  try {
    const key = farmPreviewSessionKey(projectId, entryId)
    if (!dataUrl) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, dataUrl)
  } catch (e) {
    console.warn('clipfarm: farm preview session save failed', e)
  }
}

export function getFarmPreviewSession(
  projectId: string,
  entryId: string,
): string | undefined {
  try {
    const raw = sessionStorage.getItem(farmPreviewSessionKey(projectId, entryId))
    if (typeof raw === 'string' && raw.startsWith('data:image')) return raw
  } catch {
    /* */
  }
  return undefined
}

function clearFarmPreviewSessionsForProject(projectId: string) {
  try {
    const prefix = SESSION_FARM_PREFIX + projectId + '_'
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(prefix)) sessionStorage.removeItem(k)
    }
  } catch {
    /* */
  }
}

export interface StoreShape {
  projects: Project[]
}

/** In-memory-only generations + large blobs — never persist to localStorage. */
export function stripEphemeralProjectFields(p: Project): Project {
  const { thumbnailGenerations: _tg, thumbnailDataUrl: _th, ...rest } = p
  return rest
}

function persistThumbnailSession(id: string, dataUrl: string | undefined) {
  const key = SESSION_THUMB_PREFIX + id
  try {
    if (!dataUrl) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, dataUrl)
  } catch (e) {
    console.warn('clipfarm: sessionStorage thumbnail save failed', e)
  }
}

function mergeThumbnailFromSession(p: Project): Project {
  try {
    const raw = sessionStorage.getItem(SESSION_THUMB_PREFIX + p.id)
    if (typeof raw === 'string' && raw.startsWith('data:image')) {
      return { ...p, thumbnailDataUrl: raw }
    }
  } catch {
    /* private mode / quota */
  }
  return p
}

/**
 * One-time shrink: move embedded thumbnails from localStorage into sessionStorage
 * so existing oversized clipfarm_projects keys can be rewritten under quota.
 */
function migrateLocalStorageThumbnailsToSession(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as StoreShape
    if (!Array.isArray(parsed.projects)) return
    let changed = false
    const projects = parsed.projects.map((proj: Project) => {
      const url = proj.thumbnailDataUrl
      if (typeof url === 'string' && url.length > 200) {
        try {
          sessionStorage.setItem(SESSION_THUMB_PREFIX + proj.id, url)
        } catch {
          /* */
        }
        changed = true
        const { thumbnailDataUrl: _, ...rest } = proj
        return rest as Project
      }
      return proj
    })
    if (changed) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects }))
      } catch (e) {
        console.warn('clipfarm: could not rewrite storage after thumbnail migration', e)
      }
    }
  } catch {
    /* ignore */
  }
}

function applyEndScreenDemoSeed(): void {
  try {
    if (localStorage.getItem(ENDSCREEN_DEMO_SEED_KEY)) return
    const now = new Date().toISOString()
    const projects: Project[] = [
      {
        id: 'clipfarm-demo-best-deck',
        name: 'BEST DECK CYCLE 2025!',
        title: 'BEST DECK CYCLE 2025!',
        createdAt: now,
        status: 'draft',
        lastEditedStep: 'input',
        endScreenPromoImage: '/endscreen/best-deck-cycle-2025.png',
      },
      {
        id: 'clipfarm-demo-hack-avatar',
        name: 'HACK AVATAR?? CLASH ROYALE 2025',
        title: 'HACK AVATAR?? CLASH ROYALE 2025',
        createdAt: now,
        status: 'draft',
        lastEditedStep: 'input',
        endScreenPromoImage: '/endscreen/hack-avatar-clash-2025.png',
      },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects }))
    localStorage.setItem(ENDSCREEN_DEMO_SEED_KEY, '1')
    window.dispatchEvent(new Event('clipfarm-storage'))
  } catch (e) {
    console.warn('clipfarm: end-screen demo seed skipped', e)
  }
}

export function loadStore(): StoreShape {
  applyEndScreenDemoSeed()
  migrateLocalStorageThumbnailsToSession()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { projects: [] }
    const parsed = JSON.parse(raw) as StoreShape
    if (!Array.isArray(parsed.projects)) return { projects: [] }
    return {
      projects: parsed.projects.map((proj) =>
        mergeThumbnailFromSession(stripEphemeralProjectFields(proj)),
      ),
    }
  } catch {
    return { projects: [] }
  }
}

export function saveStore(store: StoreShape): void {
  for (const p of store.projects) {
    persistThumbnailSession(p.id, p.thumbnailDataUrl)
  }
  const slim: StoreShape = {
    projects: store.projects.map((p) => stripEphemeralProjectFields(p)),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
  } catch (e) {
    console.warn(
      'clipfarm: localStorage save failed (quota?). Try clearing clipfarm_projects or old data.',
      e,
    )
    throw e
  }
  window.dispatchEvent(new Event('clipfarm-storage'))
}

/** Wipes all projects and session thumbnails/farm previews. */
export function clearAllProjects(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* */
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (
        k?.startsWith(SESSION_THUMB_PREFIX) ||
        k?.startsWith(SESSION_FARM_PREFIX)
      ) {
        sessionStorage.removeItem(k)
      }
    }
  } catch {
    /* */
  }
  window.dispatchEvent(new Event('clipfarm-storage'))
}

export function deleteProjectById(id: string): void {
  try {
    sessionStorage.removeItem(SESSION_THUMB_PREFIX + id)
  } catch {
    /* */
  }
  clearFarmPreviewSessionsForProject(id)
  const store = loadStore()
  store.projects = store.projects.filter((p) => p.id !== id)
  saveStore(store)
}

export function subscribeStorage(listener: () => void): () => void {
  window.addEventListener('clipfarm-storage', listener)
  return () => window.removeEventListener('clipfarm-storage', listener)
}
