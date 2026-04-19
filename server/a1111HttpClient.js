/**
 * POST JSON to AUTOMATIC1111 without going through HTTP(S)_PROXY (fixes "fetch failed"
 * when localhost is proxied). Uses Node http/https directly.
 */
import http from 'http'
import https from 'https'
import { URL } from 'url'

const IMG2IMG_TIMEOUT_MS = Number(process.env.A1111_TIMEOUT_MS) || 20 * 60 * 1000

/**
 * @param {string} urlString full URL e.g. http://127.0.0.1:7860/sdapi/v1/img2img
 * @param {object} jsonBody
 * @returns {Promise<object>}
 */
export function postJsonToA1111(urlString, jsonBody) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(urlString)
    } catch (e) {
      reject(e)
      return
    }

    const isHttps = u.protocol === 'https:'
    const lib = isHttps ? https : http
    const body = JSON.stringify(jsonBody)
    const path = `${u.pathname}${u.search}`

    const port =
      u.port !== ''
        ? Number(u.port)
        : isHttps
          ? 443
          : 80

    /** Prefer IPv4 loopback when URL used "localhost" (avoids ::1 vs 127.0.0.1 mismatch). */
    const hostname = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname

    const req = lib.request(
      {
        hostname,
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body, 'utf8'),
        },
        agent: false,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (!res.statusCode || res.statusCode >= 400) {
            reject(
              new Error(
                `A1111 img2img ${res.statusCode}: ${text.slice(0, 500)}`,
              ),
            )
            return
          }
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(
              new Error(
                `Invalid JSON from A1111: ${text.slice(0, 240)}`,
              ),
            )
          }
        })
      },
    )

    req.on('error', (e) => {
      const msg = e instanceof Error ? e.message : String(e)
      reject(
        new Error(
          `Cannot reach AUTOMATIC1111 at ${urlString.split('/sdapi')[0] || urlString}. Start WebUI with --api; set A1111_BASE_URL if needed. (${msg})`,
        ),
      )
    })

    req.setTimeout(IMG2IMG_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('A1111 img2img request timed out'))
    })

    req.write(body)
    req.end()
  })
}

/**
 * Normalize base URL: trim slash, map localhost -> 127.0.0.1 for stable loopback.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeA1111BaseUrl(raw) {
  let s = String(raw || 'http://127.0.0.1:7860').trim()
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  try {
    const u = new URL(s)
    if (u.hostname === 'localhost') u.hostname = '127.0.0.1'
    return u.origin
  } catch {
    return s.replace(/\/$/, '')
  }
}
