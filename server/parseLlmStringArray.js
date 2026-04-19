/**
 * Extract string arrays from messy LLM output (e.g. title:[ "a", tags:["x" ).
 */
import {
  shouldDropMetaOnlyLine,
  stripLeadInFromCandidate,
} from './stripLlmFluff.js'

export function cleanArrayElement(s) {
  let x = String(s ?? '').trim()
  x = x.replace(/^[\s\uFEFF]*[-*•]+\s*/, '')
  if (
    (x.startsWith('"') && x.endsWith('"')) ||
    (x.startsWith("'") && x.endsWith("'"))
  ) {
    x = x.slice(1, -1).trim()
  }
  x = x.replace(/^["']+|["']+$/g, '').trim()
  x = x.replace(/^(title|titles|tag|tags)\s*:\s*/i, '').trim()
  x = x.replace(/^\[+|\]+$/g, '').trim()
  return x
}

function tryParseJsonArray(slice, max) {
  try {
    let s = String(slice).trim()
    s = s.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}')
    const parsed = JSON.parse(s)
    if (Array.isArray(parsed)) {
      return parsed.map(cleanArrayElement).filter(Boolean).slice(0, max)
    }
    if (parsed && typeof parsed === 'object') {
      for (const k of ['titles', 'title', 'tags', 'tag', 'items', 'data']) {
        if (Array.isArray(parsed[k])) {
          return parsed[k].map(cleanArrayElement).filter(Boolean).slice(0, max)
        }
      }
    }
  } catch {
    /* fall through */
  }
  return null
}

function extractQuotedStrings(segment) {
  const out = []
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"/g
  let m
  while ((m = re.exec(segment)) !== null) {
    const inner = cleanArrayElement(m[1].replace(/\\"/g, '"'))
    if (inner) out.push(inner)
  }
  if (out.length) return out
  const re2 = /'([^'\\]*(?:\\.[^'\\]*)*)'/g
  while ((m = re2.exec(segment)) !== null) {
    const inner = cleanArrayElement(m[1].replace(/\\'/g, "'"))
    if (inner) out.push(inner)
  }
  return out
}

function finalizeStrings(arr, max) {
  if (!arr?.length) return []
  return arr
    .map((s) => stripLeadInFromCandidate(cleanArrayElement(String(s))))
    .filter((s) => s.length > 1 && !shouldDropMetaOnlyLine(s))
    .slice(0, max)
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
export function extractStringArrayFromLlm(text, max = 40) {
  let raw = String(text ?? '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()

  const t0 = raw.trimStart()
  if (!t0.startsWith('[') && !t0.startsWith('{')) {
    raw = raw.replace(/^[\s\n]*[a-z0-9_]+\s*:\s*/i, '').trim()
  }

  let out = []

  const start = raw.indexOf('[')
  if (start >= 0) {
    let depth = 0
    let end = -1
    for (let i = start; i < raw.length; i++) {
      const c = raw[i]
      if (c === '[') depth++
      else if (c === ']') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end > start) {
      const slice = raw.slice(start, end + 1)
      const got = tryParseJsonArray(slice, max)
      if (got?.length) out = got
      if (!out.length) {
        const quoted = extractQuotedStrings(slice)
        if (quoted.length) out = quoted.slice(0, max)
      }
    }
  }

  if (!out.length) {
    const whole = tryParseJsonArray(raw, max)
    if (whole?.length) out = whole
  }
  if (!out.length) {
    const quotedAll = extractQuotedStrings(raw)
    if (quotedAll.length) out = quotedAll.slice(0, max)
  }
  if (!out.length) {
    out = raw
      .split(/\n/)
      .map((line) =>
        line
          .replace(/^[\s]*[-*•\d.)]+\s*/, '')
          .trim(),
      )
      .map(cleanArrayElement)
      .filter((line) => line.length > 1)
  }

  return finalizeStrings(out, max)
}
