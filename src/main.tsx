import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { clearAllProjects } from './lib/storage'

/** One-time reset so the new YouTube scheduling pipeline starts from an empty dashboard. */
const RESET_STORE_KEY = 'clipfarm_reset_youtube_schedule_v1'
if (!localStorage.getItem(RESET_STORE_KEY)) {
  clearAllProjects()
  localStorage.setItem(RESET_STORE_KEY, '1')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
