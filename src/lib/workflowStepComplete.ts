import type { LastEditedStep } from '../types/project'
import type { Project } from '../types/project'

/** Whether the user may advance from this workflow step (footer Next / Input submit). */
export function canAdvanceFromStep(
  step: LastEditedStep,
  project: Project | undefined,
  videoFile: File | null,
): boolean {
  if (!project) return false
  switch (step) {
    case 'input':
      return (
        !!(project.niche ?? '').trim() &&
        project.youtubeCategoryId != null &&
        videoFile != null
      )
    case 'video-info': {
      const title = (project.title ?? '').trim()
      const desc = (project.description ?? '').trim()
      const tags = project.viewerTags ?? []
      const hasTag = tags.some((t) => (t ?? '').trim().length > 0)
      const thumb = (project.thumbnailDataUrl ?? '').trim()
      return (
        title.length > 0 &&
        desc.length > 0 &&
        hasTag &&
        thumb.length > 0
      )
    }
    case 'end-screen':
      return true
    case 'editor':
      return true
    case 'review-1':
      return (
        project.audienceKind === 'madeForKids' ||
        project.audienceKind === 'notMadeForKids'
      )
    case 'review-2':
      return false
    default:
      return false
  }
}
