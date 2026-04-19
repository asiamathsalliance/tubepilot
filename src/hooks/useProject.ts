import { useCallback, useEffect, useState } from 'react'
import { loadStore, saveStore, subscribeStorage } from '../lib/storage'
import type { Project } from '../types/project'

export function useProject(projectId: string | undefined) {
  const [project, setProject] = useState<Project | undefined>(() =>
    projectId ? loadStore().projects.find((p) => p.id === projectId) : undefined,
  )

  useEffect(() => {
    const sync = () => {
      if (!projectId) {
        setProject(undefined)
        return
      }
      setProject(loadStore().projects.find((p) => p.id === projectId))
    }
    sync()
    return subscribeStorage(sync)
  }, [projectId])

  const updateProject = useCallback(
    (partial: Partial<Project>) => {
      if (!projectId) return
      const store = loadStore()
      const idx = store.projects.findIndex((p) => p.id === projectId)
      if (idx === -1) return
      store.projects[idx] = { ...store.projects[idx], ...partial }
      saveStore(store)
    },
    [projectId],
  )

  return { project, updateProject }
}

export function useProjectsList() {
  const [projects, setProjects] = useState<Project[]>(
    () => loadStore().projects,
  )

  useEffect(() => {
    const sync = () => setProjects(loadStore().projects)
    sync()
    return subscribeStorage(sync)
  }, [])

  return projects
}
