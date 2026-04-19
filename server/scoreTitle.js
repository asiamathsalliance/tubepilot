/**
 * Model 2 — title confidence inference (loads artifacts/model2.json).
 *
 * Training (offline): high-view rows per (category_id, region) → TF–IDF centroid,
 * tag log-weights, title length stats, punctuation/digit/uppercase ratio stats.
 * Scoring blends: tags+category bucket, lexical similarity to trending titles,
 * length vs bucket, language-structure vs bucket.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let cachedArtifact = null
let cachedPath = null

export function getArtifactPath() {
  const envPath = process.env.MODEL2_JSON
  if (envPath) return envPath
  return path.join(
    __dirname,
    '..',
    'models',
    'model2-title-confidence',
    'artifacts',
    'model2.json',
  )
}

export function loadArtifact() {
  const p = getArtifactPath()
  if (cachedArtifact && cachedPath === p) return cachedArtifact
  const raw = fs.readFileSync(p, 'utf-8')
  cachedArtifact = JSON.parse(raw)
  cachedPath = p
  return cachedArtifact
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}

function tokenizeWords(title) {
  const s = String(title || '')
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u024F]/g, ' ')
  return s.split(/\s+/).filter((w) => w.length >= 2)
}

function ngrams(words) {
  const out = []
  for (const w of words) out.push(w)
  for (let i = 0; i < words.length - 1; i++) {
    out.push(`${words[i]} ${words[i + 1]}`)
  }
  return out
}

function tfVec(terms) {
  const tf = {}
  const n = terms.length || 1
  for (const t of terms) {
    tf[t] = (tf[t] || 0) + 1
  }
  const vec = {}
  for (const [t, c] of Object.entries(tf)) {
    vec[t] = c / n
  }
  return vec
}

function tfidfVec(tf, idf) {
  const vec = {}
  for (const t of Object.keys(tf)) {
    if (idf[t] != null) vec[t] = tf[t] * idf[t]
  }
  return vec
}

function medianIdf(idf) {
  const vals = Object.values(idf).filter(
    (v) => typeof v === 'number' && Number.isFinite(v),
  )
  if (!vals.length) return 1
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length / 2)]
}

/** TF–IDF with smoothed IDF for OOV terms so the query vector is not empty. */
function tfidfVecSmoothed(tf, idf) {
  const med = medianIdf(idf)
  const vec = {}
  for (const t of Object.keys(tf)) {
    const idfVal = idf[t] != null ? idf[t] : med
    vec[t] = tf[t] * idfVal
  }
  return vec
}

function cosineSim(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const va = a[k] || 0
    const vb = b[k] || 0
    dot += va * vb
    na += va * va
    nb += vb * vb
  }
  if (na < 1e-12 || nb < 1e-12) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x))
}

/** Length/structure: softer tail than |z|/3 so extreme titles are low but not forced to 0. */
function zToScoreSoft(z, scale = 4.5) {
  return clamp01(1 - Math.min(1, Math.abs(z) / scale)) * 100
}

function zToScore(z) {
  return zToScoreSoft(z, 4.5)
}

function titleStructureRatios(s) {
  if (!s) {
    return { punctRatio: 0, digitRatio: 0, upperRatio: 0 }
  }
  const n = s.length
  let punct = 0
  let digit = 0
  let upper = 0
  for (let i = 0; i < n; i++) {
    const c = s[i]
    if (c >= '0' && c <= '9') digit++
    if (c === c.toUpperCase() && c !== c.toLowerCase()) upper++
    const isAlnum = /[a-zA-Z0-9\u00C0-\u024F]/.test(c)
    if (!isAlnum && !/\s/.test(c)) punct++
  }
  return {
    punctRatio: punct / Math.max(n, 1),
    digitRatio: digit / Math.max(n, 1),
    upperRatio: upper / Math.max(n, 1),
  }
}

function parseUserTags(tags) {
  if (!Array.isArray(tags)) return []
  const out = []
  for (const t of tags) {
    const parts = String(t)
      .toLowerCase()
      .split(/[|,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    out.push(...parts)
  }
  return [...new Set(out)]
}

/** Terms from bucket vocabulary + sample titles for OOV / empty TF–IDF fallback. */
function referenceTermSet(bucket) {
  const s = new Set()
  const addKeys = (obj) => {
    for (const k of Object.keys(obj || {})) {
      for (const w of String(k).toLowerCase().split(/\s+/)) {
        if (w.length >= 2) s.add(w)
      }
    }
  }
  addKeys(bucket.centroidTf)
  addKeys(bucket.idf)
  for (const line of bucket.sampleTitles || []) {
    for (const w of tokenizeWords(String(line))) s.add(w)
  }
  return s
}

function jaccardWordsToRef(words, refSet) {
  if (!words.length || refSet.size === 0) return 0
  const a = new Set(words)
  let inter = 0
  for (const t of a) if (refSet.has(t)) inter++
  const union = a.size + refSet.size - inter
  return union > 0 ? inter / union : 0
}

function resolveWeights(artifact) {
  const w = artifact.weights || {}
  if (w.tagAndCategory != null) {
    return {
      tagAndCategory: w.tagAndCategory,
      trendingLexical: w.trendingLexical,
      titleLength: w.titleLength,
      languageStructure: w.languageStructure,
    }
  }
  return {
    tagAndCategory: w.tag ?? 0.35,
    trendingLexical: w.similarity ?? 0.45,
    titleLength: (w.pattern ?? 0.2) * 0.5,
    languageStructure: (w.pattern ?? 0.2) * 0.5,
  }
}

/**
 * @param {object} artifact
 * @param {{ title: string, tags?: string[], categoryId: number, region?: string }} input
 */
export function scoreTitle(artifact, input) {
  const weights = resolveWeights(artifact)
  const catKey = String(Number(input.categoryId))
  const regionPref = (input.region || 'GLOBAL').toUpperCase()

  let bucket =
    artifact.categories?.[catKey]?.regions?.[regionPref] ||
    artifact.categories?.[catKey]?.regions?.GLOBAL

  if (!bucket && artifact.categories?.[catKey]?.regions) {
    const regs = artifact.categories[catKey].regions
    bucket = regs[Object.keys(regs)[0]]
  }

  const title = String(input.title || '')
  const words = tokenizeWords(title)
  const terms = ngrams(words)
  const tf = tfVec(terms)

  let tagAndCategoryScore = 50
  let trendingLexicalScore = 50
  let titleLengthScore = 50
  let languageStructureScore = 50
  const notes = []

  if (!bucket) {
    notes.push(
      `No training bucket for category_id=${catKey}; using neutral mid-scores.`,
    )
  } else {
    const idf = bucket.idf || {}
    const centroid = bucket.centroidTf || {}
    const hasVocab =
      Object.keys(idf).length > 0 && Object.keys(centroid).length > 0
    const qVec = hasVocab ? tfidfVecSmoothed(tf, idf) : {}
    const qHasVec = Object.keys(qVec).length > 0

    if (hasVocab && qHasVec) {
      const sim = cosineSim(qVec, centroid)
      trendingLexicalScore = sim * 100
      if (trendingLexicalScore < 1e-6) {
        const refSet = referenceTermSet(bucket)
        const j = jaccardWordsToRef(words, refSet)
        if (j > 0) {
          trendingLexicalScore = round2(Math.max(trendingLexicalScore, 25 + 75 * j))
        }
      }
    } else if (!hasVocab) {
      const refSet = referenceTermSet(bucket)
      const j = jaccardWordsToRef(words, refSet)
      trendingLexicalScore =
        refSet.size === 0
          ? 50
          : round2(28 + 72 * j)
    } else {
      trendingLexicalScore = 50
    }

    const topTags = bucket.topTags || []
    const imp = bucket.tagImportance || {}
    const userTags = parseUserTags(input.tags || [])
    if (topTags.length) {
      if (userTags.length) {
        const setU = new Set(userTags)
        const setT = new Set(topTags)
        let inter = 0
        for (const t of setU) if (setT.has(t)) inter++
        const u = new Set([...setU, ...setT]).size
        const jacc = u > 0 ? inter / u : 0
        let wSum = 0
        for (const t of userTags) {
          if (setT.has(t) && imp[t]) wSum += Math.log1p(imp[t])
        }
        const wBoost = Math.min(1, wSum / (15 + wSum))
        tagAndCategoryScore = clamp01(jacc * 0.75 + wBoost * 0.25) * 100
      } else {
        tagAndCategoryScore = 38
        notes.push('Add viewer tags to improve tag/category alignment.')
      }
    }

    const len = title.length
    const wc = words.length
    const lm = bucket.titleLenMean ?? 45
    const ls = bucket.titleLenStd || 15
    const wm = bucket.wordCountMean ?? 8
    const ws = bucket.wordCountStd || 4
    const zLenRaw = ls > 0 ? (len - lm) / ls : 0
    const zWcRaw = ws > 0 ? (wc - wm) / ws : 0
    const zLen = Math.max(-4.5, Math.min(4.5, zLenRaw))
    const zWc = Math.max(-4.5, Math.min(4.5, zWcRaw))
    titleLengthScore = (zToScoreSoft(zLen, 4.5) + zToScoreSoft(zWc, 4.5)) / 2

    const st = titleStructureRatios(title)
    const pm = bucket.punctRatioMean
    if (pm != null && bucket.punctRatioStd != null) {
      const zp =
        bucket.punctRatioStd > 0
          ? (st.punctRatio - bucket.punctRatioMean) / bucket.punctRatioStd
          : 0
      const zd =
        bucket.digitRatioStd > 0
          ? (st.digitRatio - bucket.digitRatioMean) / bucket.digitRatioStd
          : 0
      const zu =
        bucket.upperRatioStd > 0
          ? (st.upperRatio - bucket.upperRatioMean) / bucket.upperRatioStd
          : 0
      languageStructureScore =
        (zToScoreSoft(zp, 4.5) + zToScoreSoft(zd, 4.5) + zToScoreSoft(zu, 4.5)) /
        3
    } else {
      languageStructureScore = titleLengthScore
    }
  }

  const sumW =
    weights.tagAndCategory +
    weights.trendingLexical +
    weights.titleLength +
    weights.languageStructure
  const raw =
    (weights.tagAndCategory * tagAndCategoryScore +
      weights.trendingLexical * trendingLexicalScore +
      weights.titleLength * titleLengthScore +
      weights.languageStructure * languageStructureScore) /
    (sumW > 0 ? sumW : 1)

  const finalScore = round2(Math.max(0, Math.min(100, raw)))

  return {
    score: finalScore,
    breakdown: {
      tagAndCategoryScore: round2(tagAndCategoryScore),
      trendingLexicalSimilarity: round2(trendingLexicalScore),
      titleLengthScore: round2(titleLengthScore),
      languageStructureScore: round2(languageStructureScore),
      notes,
    },
  }
}

/**
 * Model 2 — Tag confidence: same artifact & weights as title scoring, tuned for
 * a single tag string (dataset topTags / tagImportance, TF–IDF vs centroid, tag length vs bucket tags).
 *
 * @param {object} artifact
 * @param {{ tag: string, transcript?: string, tags?: string[], categoryId: number, region?: string }} input
 */
export function scoreTagConfidence(artifact, input) {
  const weights = resolveWeights(artifact)
  const catKey = String(Number(input.categoryId))
  const regionPref = (input.region || 'GLOBAL').toUpperCase()

  let bucket =
    artifact.categories?.[catKey]?.regions?.[regionPref] ||
    artifact.categories?.[catKey]?.regions?.GLOBAL

  if (!bucket && artifact.categories?.[catKey]?.regions) {
    const regs = artifact.categories[catKey].regions
    bucket = regs[Object.keys(regs)[0]]
  }

  const tagRaw = String(input.tag || '').trim()
  const tagLc = tagRaw.toLowerCase()
  const userTags = parseUserTags(input.tags || [])
  const transcript = String(input.transcript || '')
  const transcriptWords = new Set(tokenizeWords(transcript))

  let tagAndCategoryScore = 42
  let trendingLexicalScore = 50
  let titleLengthScore = 55
  let languageStructureScore = 55
  const notes = []

  if (!bucket) {
    notes.push(
      `No training bucket for category_id=${catKey}; using neutral mid-scores.`,
    )
  } else {
    const topTags = (bucket.topTags || []).map((t) => String(t).toLowerCase())
    const imp = bucket.tagImportance || {}
    const impVals = Object.values(imp).filter(
      (v) => typeof v === 'number' && Number.isFinite(v),
    )
    const maxImp = impVals.length ? Math.max(...impVals) : 1

    if (topTags.includes(tagLc)) {
      tagAndCategoryScore = 92
      if (imp[tagLc] != null) {
        tagAndCategoryScore = Math.min(
          100,
          82 + 18 * ((imp[tagLc] ?? 0) / maxImp),
        )
      }
    } else if (imp[tagLc] != null) {
      tagAndCategoryScore = 52 + 42 * ((imp[tagLc] ?? 0) / maxImp)
    } else {
      let best = 36
      for (const tt of topTags) {
        if (tt.includes(tagLc) || tagLc.includes(tt)) best = Math.max(best, 74)
      }
      for (const k of Object.keys(imp)) {
        const kl = String(k).toLowerCase()
        if (kl.includes(tagLc) || tagLc.includes(kl)) {
          best = Math.max(
            best,
            44 + 38 * ((imp[k] ?? 0) / maxImp),
          )
        }
      }
      tagAndCategoryScore = best
    }

    if (userTags.length) {
      if (userTags.includes(tagLc)) {
        tagAndCategoryScore = Math.min(100, tagAndCategoryScore + 14)
      }
      const setU = new Set(userTags)
      const setT = new Set(topTags)
      let inter = 0
      for (const t of setU) if (setT.has(t)) inter++
      const u = new Set([...setU, ...setT]).size
      const jacc = u > 0 ? inter / u : 0
      tagAndCategoryScore = tagAndCategoryScore * 0.86 + jacc * 100 * 0.14
    }

    const words = tokenizeWords(tagRaw)
    const terms = ngrams(words)
    const tf = tfVec(terms)

    const idf = bucket.idf || {}
    const centroid = bucket.centroidTf || {}
    const hasVocab =
      Object.keys(idf).length > 0 && Object.keys(centroid).length > 0
    const qVec = hasVocab ? tfidfVecSmoothed(tf, idf) : {}
    const qHasVec = Object.keys(qVec).length > 0

    if (hasVocab && qHasVec) {
      const sim = cosineSim(qVec, centroid)
      trendingLexicalScore = sim * 100
      if (trendingLexicalScore < 1e-6) {
        const refSet = referenceTermSet(bucket)
        const j = jaccardWordsToRef(words, refSet)
        if (j > 0) {
          trendingLexicalScore = round2(
            Math.max(trendingLexicalScore, 25 + 75 * j),
          )
        }
      }
    } else if (!hasVocab) {
      const refSet = referenceTermSet(bucket)
      const j = jaccardWordsToRef(words, refSet)
      trendingLexicalScore =
        refSet.size === 0 ? 50 : round2(28 + 72 * j)
    } else {
      trendingLexicalScore = 50
    }

    const lengths = topTags.map((t) => String(t).length).filter((n) => n > 0)
    let lm = 10
    let ls = 5
    if (lengths.length >= 2) {
      lm = lengths.reduce((a, b) => a + b, 0) / lengths.length
      const varSum =
        lengths.map((L) => (L - lm) ** 2).reduce((a, b) => a + b, 0) /
        lengths.length
      ls = Math.sqrt(varSum) || 4
    } else if (lengths.length === 1) {
      lm = lengths[0]
      ls = 4
    }
    const len = tagRaw.length
    const zLenRaw = ls > 0 ? (len - lm) / ls : 0
    const zLen = Math.max(-4.5, Math.min(4.5, zLenRaw))
    titleLengthScore = zToScoreSoft(zLen, 4.5)

    const st = titleStructureRatios(tagRaw)
    const pm = bucket.punctRatioMean
    if (pm != null && bucket.punctRatioStd != null) {
      const zp =
        bucket.punctRatioStd > 0
          ? (st.punctRatio - bucket.punctRatioMean) / bucket.punctRatioStd
          : 0
      const zd =
        bucket.digitRatioStd > 0
          ? (st.digitRatio - bucket.digitRatioMean) / bucket.digitRatioStd
          : 0
      const zu =
        bucket.upperRatioStd > 0
          ? (st.upperRatio - bucket.upperRatioMean) / bucket.upperRatioStd
          : 0
      languageStructureScore =
        (zToScoreSoft(zp, 4.5) + zToScoreSoft(zd, 4.5) + zToScoreSoft(zu, 4.5)) /
        3
    } else {
      languageStructureScore = titleLengthScore
    }

    let ov = 0
    for (const w of words) if (transcriptWords.has(w)) ov++
    const transcriptHit = words.length ? ov / words.length : 0
    tagAndCategoryScore = Math.min(
      100,
      tagAndCategoryScore + transcriptHit * 22,
    )
    trendingLexicalScore = Math.min(
      100,
      trendingLexicalScore + transcriptHit * 15,
    )
  }

  const sumW =
    weights.tagAndCategory +
    weights.trendingLexical +
    weights.titleLength +
    weights.languageStructure
  const raw =
    (weights.tagAndCategory * tagAndCategoryScore +
      weights.trendingLexical * trendingLexicalScore +
      weights.titleLength * titleLengthScore +
      weights.languageStructure * languageStructureScore) /
    (sumW > 0 ? sumW : 1)

  const finalScore = round2(Math.max(0, Math.min(100, raw)))

  return {
    score: finalScore,
    breakdown: {
      tagAndCategoryScore: round2(tagAndCategoryScore),
      trendingLexicalSimilarity: round2(trendingLexicalScore),
      titleLengthScore: round2(titleLengthScore),
      languageStructureScore: round2(languageStructureScore),
      notes,
    },
  }
}

export function scoreTagConfidenceFromFile(body) {
  const art = loadArtifact()
  return scoreTagConfidence(art, body)
}

export function scoreTitleFromFile(body) {
  const art = loadArtifact()
  return scoreTitle(art, body)
}
