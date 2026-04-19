/**
 * Remove throat-clearing / framing from LLM outputs so UI shows only real content.
 */

/**
 * @param {string} s
 * @returns {string}
 */
export function stripLeadInFromCandidate(s) {
  let t = String(s ?? '').trim()
  if (!t) return ''

  const colon = t.match(
    /^(?:here|below)\s+(?:is|are)\s+(?:a\s+)?(?:possible\s+)?(?:the\s+)?(?:following\s+)?[^\n:]{0,280}[:：]\s*(.+)$/is,
  )
  if (colon?.[1] && colon[1].trim().length > 2) {
    t = colon[1].trim()
  }

  t = t.replace(
    /^(here|below)\s+(is|are)\s+(?:a\s+)?(?:possible\s+)?(?:the\s+)?(?:youtube\s+)?(?:video\s+)?(?:title|description|tag|tags|option|options|paragraph|paragraphs)?\b[^.!?\n]{0,220}[.!?:]\s+/i,
    '',
  )
  t = t.replace(
    /^(here|below)\s+(is|are)\s+(?:a\s+)?(?:possible\s+)?[^.!?\n]{0,140}[.!?:]\s+/i,
    '',
  )
  t = t.replace(/^(title|description|tag|tags)\s*[:：]\s*/i, '')
  return t.trim()
}

/**
 * Drop strings that are only LLM preamble with no real payload (no colon split).
 * @param {string} s
 */
export function shouldDropMetaOnlyLine(s) {
  const t = String(s).trim()
  if (!t) return true
  if (t.length < 200 && /^(here|below)\s+(is|are)\s+/i.test(t) && !/[:：]/.test(t)) {
    return true
  }
  if (/^(sure|certainly|absolutely|okay)[!,]?\s*$/i.test(t)) return true
  return false
}
