import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadStore, saveStore } from '../lib/storage'
import { projectStepPath } from '../lib/routes'
import type { Project } from '../types/project'

function newId() {
  return crypto.randomUUID()
}

export function StartNewProject() {
  const navigate = useNavigate()
  const [name, setName] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    const id = newId()
    const project: Project = {
      id,
      name: trimmed,
      createdAt: new Date().toISOString(),
      status: 'draft',
      lastEditedStep: 'input',
    }

    const store = loadStore()
    store.projects.push(project)
    saveStore(store)
    navigate(projectStepPath(id, 'input'))
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
        Start New Project
      </h1>
      <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
        Name your project, then continue to upload and configure your video.
      </p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="project-name" className="label-lg block">
            Project name
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field mt-2"
            placeholder="My awesome video"
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={!name.trim()}
          className="btn-3d-accent w-full py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          Create Project
        </button>
      </form>
    </div>
  )
}
