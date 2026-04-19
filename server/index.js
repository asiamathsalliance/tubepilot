/**
 * Standalone API server (optional). Dev uses Vite middleware + createApp() instead.
 *
 * Env: PORT (default 8787), OLLAMA_URL, OLLAMA_MODEL, OLLAMA_PIPELINE_MODEL, WHISPER_MODEL
 */

import { createApp } from './app.js'

const PORT = Number(process.env.PORT) || 8787

const app = createApp()
const server = app.listen(PORT, () => {
  console.log(`Clipfarm API listening on http://127.0.0.1:${PORT}`)
})
server.timeout = 60 * 60 * 1000
server.headersTimeout = 65 * 60 * 1000
