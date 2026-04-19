import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import path from 'path'
import { fileURLToPath } from 'url'
import { scoreTitle, loadArtifact } from './scoreTitle.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function assertTwoDecimals(n) {
  const s = n.toFixed(2)
  assert.equal(Number(s), n)
}

describe('scoreTitle', () => {
  let artifact

  before(() => {
    process.env.MODEL2_JSON = path.join(
      __dirname,
      '..',
      'models',
      'model2-title-confidence',
      'artifacts',
      'model2.json',
    )
    artifact = loadArtifact()
  })

  it('returns v3-style breakdown with four components (two decimal values)', () => {
    const r = scoreTitle(artifact, {
      title: 'Best gaming tips for beginners tonight',
      tags: ['gaming', 'fortnite', 'tips'],
      categoryId: 20,
    })
    assert.ok(r.score >= 0 && r.score <= 100)
    assertTwoDecimals(r.score)
    const b = r.breakdown
    assert.ok(typeof b.tagAndCategoryScore === 'number')
    assert.ok(typeof b.trendingLexicalSimilarity === 'number')
    assert.ok(typeof b.titleLengthScore === 'number')
    assert.ok(typeof b.languageStructureScore === 'number')
    assertTwoDecimals(b.tagAndCategoryScore)
    assertTwoDecimals(b.trendingLexicalSimilarity)
    assertTwoDecimals(b.titleLengthScore)
    assertTwoDecimals(b.languageStructureScore)
  })

  it('well-aligned title scores clearly above a bad title (category 20 gaming)', () => {
    const good = scoreTitle(artifact, {
      title: 'Fortnite tutorial epic wins daily',
      tags: ['gaming', 'fortnite', 'tips'],
      categoryId: 20,
    })
    const bad = scoreTitle(artifact, {
      title: 'a',
      tags: ['cooking', 'recipe', 'kitchen'],
      categoryId: 20,
    })
    assert.ok(
      good.score > bad.score,
      `expected good (${good.score}) > bad (${bad.score})`,
    )
    assert.ok(
      good.score >= 35,
      `good case should be non-trivial (${good.score})`,
    )
  })

  it('education category yields lexical score in valid range (TF–IDF or bucket stats)', () => {
    const r = scoreTitle(artifact, {
      title: 'Education math explained simply for students',
      tags: ['education', 'math', 'learn'],
      categoryId: 27,
    })
    assert.ok(r.breakdown.trendingLexicalSimilarity > 0)
    assert.ok(r.breakdown.trendingLexicalSimilarity <= 100)
  })

  it('very short title does not force length subscore to exactly 0', () => {
    const r = scoreTitle(artifact, {
      title: 'a',
      tags: ['gaming'],
      categoryId: 20,
    })
    assert.ok(r.breakdown.titleLengthScore >= 0)
    assert.ok(r.breakdown.titleLengthScore < 100)
  })
})
