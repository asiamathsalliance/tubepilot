import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error — server/app.js is plain JS (no .d.ts); runtime import is valid for Vite Node.
import { createApp } from './server/app.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'clipfarm-api',
      configureServer(server) {
        const api = createApp()
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? ''
          if (url.startsWith('/api')) {
            api(req, res, next)
          } else {
            next()
          }
        })
      },
    },
    react(),
    tailwindcss(),
  ],
})
