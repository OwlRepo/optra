import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildEvidencePack } from './context'
import { countTokens } from '../tokens'

describe('buildEvidencePack (#5 compact evidence pack + token budget)', () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.RAG_CONTEXT_TOKEN_BUDGET
  })

  afterEach(() => {
    process.env = env
  })

  it('returns empty string for no chunks', () => {
    expect(buildEvidencePack([])).toBe('')
  })

  it('includes all chunks under budget, ordered by score descending', () => {
    const pack = buildEvidencePack(
      [
        { content: 'LOW score content', score: 0.40, metadata: { title: 'Low doc' } },
        { content: 'HIGH score content', score: 0.95, metadata: { title: 'High doc' } },
        { content: 'MID score content', score: 0.70, metadata: { title: 'Mid doc' } },
      ],
      10_000,
    )

    expect(pack).toContain('HIGH score content')
    expect(pack).toContain('MID score content')
    expect(pack).toContain('LOW score content')
    // score labels present
    expect(pack).toContain('0.95')
    // highest score appears before lowest
    expect(pack.indexOf('HIGH score content')).toBeLessThan(pack.indexOf('LOW score content'))
  })

  it('respects the token budget and drops the lowest-scored chunks', () => {
    const budget = 40
    const pack = buildEvidencePack(
      [
        { content: 'ALPHA '.repeat(30), score: 0.95, metadata: { title: 'A' } },
        { content: 'OMEGA '.repeat(30), score: 0.20, metadata: { title: 'B' } },
      ],
      budget,
    )

    expect(countTokens(pack)).toBeLessThanOrEqual(budget)
    expect(pack).toContain('ALPHA')
    expect(pack).not.toContain('OMEGA')
  })

  it('truncates a single oversized chunk to fit the budget', () => {
    const budget = 30
    const huge = 'word '.repeat(500)
    const pack = buildEvidencePack([{ content: huge, score: 0.9, metadata: {} }], budget)

    expect(countTokens(pack)).toBeLessThanOrEqual(budget)
    expect(pack.length).toBeLessThan(huge.length)
  })

  it('reads RAG_CONTEXT_TOKEN_BUDGET from env by default', () => {
    process.env.RAG_CONTEXT_TOKEN_BUDGET = '25'
    const pack = buildEvidencePack([{ content: 'token '.repeat(200), score: 0.9, metadata: {} }])
    expect(countTokens(pack)).toBeLessThanOrEqual(25)
  })
})
