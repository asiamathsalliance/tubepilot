import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useProject } from '../../hooks/useProject'
import { useVideoPreview } from '../../hooks/useVideoPreview'
import { projectStepPath } from '../../lib/routes'
import {
  getNextStep,
  getPrevStep,
  stepFromPathname,
} from '../../lib/projectStepRoutes'
import { canAdvanceFromStep } from '../../lib/workflowStepComplete'
import type { Review2FooterPayload } from './workflowOutletContext'

const INPUT_FORM_ID = 'project-input-form'

export function ProjectWorkflowLayout() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { project, updateProject } = useProject(id)
  const { videoFile } = useVideoPreview(id)
  const step = stepFromPathname(location.pathname)
  const canAdvance =
    step != null ? canAdvanceFromStep(step, project, videoFile ?? null) : false

  const [review2Footer, setReview2Footer] = useState<Review2FooterPayload | null>(
    null,
  )

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    if (step !== 'review-2') setReview2Footer(null)
  }, [step])
  const prevStep = step ? getPrevStep(step) : null
  const nextStep = step ? getNextStep(step) : null

  const prevHref =
    !id || !step
      ? '/'
      : prevStep === null
        ? '/'
        : projectStepPath(id, prevStep)

  function goNext() {
    if (!id || !step || !nextStep || !canAdvance) return
    // Relative navigation fixes nested `/projects/:id/*` child routing in React Router 7
    // when moving between steps (e.g. editor → review-1 with no clips queued).
    navigate(`../${nextStep}`, { relative: 'path' })
    updateProject({ lastEditedStep: nextStep })
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <Outlet
        key={location.pathname}
        context={{ registerReview2Footer: setReview2Footer }}
      />
      <footer className="mt-12 flex w-full items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-100/80 py-5 dark:border-zinc-700 dark:bg-zinc-950/80">
        <Link to={prevHref} className="workflow-nav-btn">
          Previous
        </Link>
        {step === 'input' && id ? (
          <button
            type="submit"
            form={INPUT_FORM_ID}
            disabled={!canAdvance}
            title={!canAdvance ? 'Complete niche, category, and video upload to continue' : undefined}
            className="workflow-nav-btn-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        ) : step === 'review-2' && review2Footer ? (
          <button
            type="button"
            onClick={() => void review2Footer.onConfirm()}
            disabled={review2Footer.disabled}
            className="workflow-nav-btn-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirm and Upload
          </button>
        ) : step === 'review-2' ? (
          <span className="min-w-[4.5rem]" aria-hidden />
        ) : nextStep && id ? (
          <button
            type="button"
            onClick={goNext}
            disabled={!canAdvance}
            title={!canAdvance ? 'Complete required fields on this page to continue' : undefined}
            className="workflow-nav-btn-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        ) : null}
      </footer>
    </div>
  )
}

/** Form id wired to the workflow footer Next (submit) on the Input step. */
export { INPUT_FORM_ID }
