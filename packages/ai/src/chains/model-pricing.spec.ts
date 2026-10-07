import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODEL, resolveModel, type ModelRole } from './models'
import { MODEL_PRICES, priceFor } from '../pricing'

// A model with no MODEL_PRICES row is billed as gpt-4-turbo with a warning
// (pricing.ts). That is safe but wrong for a default we ship, so every model
// reachable without operator config must have its own row.

const ROLES: ModelRole[] = ['answer', 'rewrite', 'grade', 'extraction', 'refine', 'condense', 'sql', 'faq', 'procurement']
const MODEL_ENV = [
  'OPENAI_CHAT_MODEL',
  'OPENAI_ANSWER_MODEL',
  'OPENAI_REWRITE_MODEL',
  'OPENAI_GRADE_MODEL',
  'OPENAI_EXTRACTION_MODEL',
  'OPENAI_REFINE_MODEL',
  'OPENAI_CONDENSE_MODEL',
  'OPENAI_SQL_MODEL',
  'OPENAI_FAQ_MODEL',
  'OPENAI_PROCUREMENT_EXTRACTION_MODEL',
]

describe('default models have a price row', () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
    for (const key of MODEL_ENV) delete process.env[key]
  })

  afterEach(() => {
    process.env = env
    vi.restoreAllMocks()
  })

  it('error: DEFAULT_MODEL is exported by models.ts and has its own MODEL_PRICES row', () => {
    expect(typeof DEFAULT_MODEL).toBe('string')
    expect(Object.keys(MODEL_PRICES)).toContain(DEFAULT_MODEL)
  })

  it.each(ROLES)('edge: with no env set the %s role resolves to a priced model (no unknown-model fallback)', (role) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const model = resolveModel(role)
    priceFor(model)

    expect(warn).not.toHaveBeenCalled()
  })

  it('edge: every model named in .env.example (OPENAI_*_MODEL, RAGAS_JUDGE_MODEL) has a price row', () => {
    const text = readFileSync(join(__dirname, '../../../../.env.example'), 'utf8')
    const models = [...text.matchAll(/^(?:OPENAI_[A-Z_]*MODEL|RAGAS_JUDGE_MODEL)=(\S+)/gm)].map((match) => match[1])

    expect(models.length).toBeGreaterThan(0)
    for (const model of models) expect(Object.keys(MODEL_PRICES)).toContain(model)
  })

  it('happy: the default embedding model has a price row', () => {
    expect(Object.keys(MODEL_PRICES)).toContain('text-embedding-3-small')
  })
})
