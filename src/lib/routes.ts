import type { LastEditedStep } from '../types/project'

export function projectStepPath(id: string, step: LastEditedStep): string {
  const paths: Record<LastEditedStep, string> = {
    input: `/projects/${id}/input`,
    'video-info': `/projects/${id}/video-info`,
    'end-screen': `/projects/${id}/end-screen`,
    editor: `/projects/${id}/editor`,
    'review-1': `/projects/${id}/review-1`,
    'review-2': `/projects/${id}/review-2`,
  }
  return paths[step]
}
