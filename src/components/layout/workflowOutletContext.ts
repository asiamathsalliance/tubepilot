/** Passed to child routes via React Router `<Outlet context={...} />`. */
export type Review2FooterPayload = {
  onConfirm: () => void | Promise<void>
  disabled?: boolean
}

export type ProjectWorkflowOutletContext = {
  registerReview2Footer: (payload: Review2FooterPayload | null) => void
}
