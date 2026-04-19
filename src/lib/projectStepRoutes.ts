import { matchPath } from 'react-router-dom'
import type { LastEditedStep } from '../types/project'

/** Ordered workflow steps under `/projects/:id/:step`. */
export const PROJECT_STEPS: readonly LastEditedStep[] = [
  'input',
  'video-info',
  'end-screen',
  'editor',
  'review-1',
  'review-2',
] as const

/** Resolve workflow step from URL (handles trailing slash; uses router matching). */
export function stepFromPathname(pathname: string): LastEditedStep | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const step of PROJECT_STEPS) {
    const hit = matchPath(
      { path: `/projects/:id/${step}`, end: true },
      path,
    )
    if (hit) return step
  }
  return null
}

export function stepIndex(step: LastEditedStep): number {
  return PROJECT_STEPS.indexOf(step)
}

export function getPrevStep(step: LastEditedStep): LastEditedStep | null {
  const i = stepIndex(step)
  if (i <= 0) return null
  return PROJECT_STEPS[i - 1]!
}

export function getNextStep(step: LastEditedStep): LastEditedStep | null {
  const i = stepIndex(step)
  if (i < 0 || i >= PROJECT_STEPS.length - 1) return null
  return PROJECT_STEPS[i + 1]!
}
