import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { useEffect } from 'react'
import { useProject } from '../../hooks/useProject'
import { projectStepPath } from '../../lib/routes'
import {
  getNextStep,
  getPrevStep,
  stepFromPathname,
} from '../../lib/projectStepRoutes'

const INPUT_FORM_ID = 'project-input-form'

export function ProjectWorkflowLayout() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { updateProject } = useProject(id)
  const step = stepFromPathname(location.pathname)

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])
  const prevStep = step ? getPrevStep(step) : null
  const nextStep = step ? getNextStep(step) : null

  const prevHref =
    !id || !step
      ? '/'
      : prevStep === null
        ? '/'
        : projectStepPath(id, prevStep)

  function goNext() {
    if (!id || !step || !nextStep) return
    const path = projectStepPath(id, nextStep)
    navigate(path)
    updateProject({ lastEditedStep: nextStep })
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <Outlet key={location.pathname} />
      <footer className="mt-12 flex w-full items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-100/80 py-5 dark:border-zinc-700 dark:bg-zinc-950/80">
        <Link to={prevHref} className="workflow-nav-btn">
          Previous
        </Link>
        {step === 'input' && id ? (
          <button
            type="submit"
            form={INPUT_FORM_ID}
            className="workflow-nav-btn-primary"
          >
            Next
          </button>
        ) : step === 'review-2' ? (
          <span className="min-w-[4.5rem]" aria-hidden />
        ) : nextStep && id ? (
          <button type="button" onClick={goNext} className="workflow-nav-btn-primary">
            Next
          </button>
        ) : null}
      </footer>
    </div>
  )
}

/** Form id wired to the workflow footer Next (submit) on the Input step. */
export { INPUT_FORM_ID }
