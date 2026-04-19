/**
 * Resolve snippet.categoryId values that YouTube Data API accepts.
 * Merges videoCategories.list across regions so Shorts (42) and common IDs are available.
 * @see https://developers.google.com/youtube/v3/docs/videoCategories/list
 */

/** @type {Set<number> | null} */
let cachedIds = null

const EXTRA_REGIONS = ['US', 'GB', 'AU']

/**
 * @param {import('googleapis').youtube_v3.Youtube} youtube authenticated client
 * @param {string} [regionCode] primary region (also merged with US/GB/AU)
 * @returns {Promise<Set<number>>}
 */
const FALLBACK_CATEGORY_IDS = [
  1, 2, 10, 15, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
  35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
]

export async function getYoutubeCategoryIdSet(youtube, regionCode) {
  const primary = regionCode || process.env.YOUTUBE_REGION_CODE || 'US'
  if (cachedIds && cachedIds.size > 0) return cachedIds

  const ids = new Set()
  const regions = [...new Set([primary, ...EXTRA_REGIONS])]
  for (const rc of regions) {
    try {
      const res = await youtube.videoCategories.list({
        part: ['snippet'],
        regionCode: rc,
      })
      for (const it of res.data.items ?? []) {
        const id = it.id
        if (id != null && !Number.isNaN(Number(id))) ids.add(Number(id))
      }
    } catch (e) {
      console.warn(`youtube videoCategories.list region=${rc}:`, e)
    }
  }
  if (ids.size === 0) {
    for (const n of FALLBACK_CATEGORY_IDS) ids.add(n)
  }
  cachedIds = ids
  return ids
}

/**
 * @param {Set<number>} validIds from videoCategories.list
 * @param {unknown} categoryId from client metadata
 * @param {boolean} isShort
 * @returns {number}
 */
export function normalizeSnippetCategoryId(validIds, categoryId, isShort) {
  let n = Number(categoryId)
  if (!Number.isFinite(n)) n = 22

  if (isShort) {
    // Prefer standard upload-safe ids first; 42 appears in videoCategories.list but
    // videos.insert can still reject it for some channels/regions.
    for (const c of [24, 23, 22, 26, 25, 10]) {
      if (validIds.has(c)) return c
    }
    if (validIds.has(42)) return 42
    const sorted = [...validIds].sort((a, b) => a - b)
    return sorted.find((x) => x >= 17) ?? sorted[0] ?? 22
  }

  let out = n
  if (out === 42) out = 22
  if (validIds.has(out)) return out
  if (validIds.has(22)) return 22
  for (const c of [24, 23, 26, 25, 10]) {
    if (validIds.has(c)) return c
  }
  const sorted = [...validIds].sort((a, b) => a - b)
  return sorted[0] ?? 22
}
