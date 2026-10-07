import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveModel } from './models'

describe('resolveModel (#3 per-task model configs)', () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.OPENAI_ANSWER_MODEL
    delete process.env.OPENAI_REWRITE_MODEL
    delete process.env.OPENAI_GRADE_MODEL
    delete process.env.OPENAI_EXTRACTION_MODEL
    delete process.env.OPENAI_CONDENSE_MODEL
    delete process.env.OPENAI_CHAT_MODEL
    delete process.env.OPENAI_REFINE_MODEL
    delete process.env.OPENAI_SQL_MODEL
    delete process.env.OPENAI_FAQ_MODEL
    delete process.env.OPENAI_PROCUREMENT_EXTRACTION_MODEL
  })

  afterEach(() => {
    process.env = env
  })

  it('uses the role-specific model when set', () => {
    process.env.OPENAI_REWRITE_MODEL = 'gpt-4o-mini'
    process.env.OPENAI_CHAT_MODEL = 'gpt-4-turbo'
    expect(resolveModel('rewrite')).toBe('gpt-4o-mini')
  })

  it('resolves the condense role from OPENAI_CONDENSE_MODEL', () => {
    process.env.OPENAI_CONDENSE_MODEL = 'gpt-4o-mini'
    process.env.OPENAI_CHAT_MODEL = 'gpt-4-turbo'
    expect(resolveModel('condense')).toBe('gpt-4o-mini')
  })

  it('falls back to OPENAI_CHAT_MODEL when the role model is unset', () => {
    process.env.OPENAI_CHAT_MODEL = 'gpt-4o'
    expect(resolveModel('grade')).toBe('gpt-4o')
    expect(resolveModel('answer')).toBe('gpt-4o')
  })

  it('ignores empty/whitespace role values and falls through', () => {
    process.env.OPENAI_GRADE_MODEL = '   '
    process.env.OPENAI_CHAT_MODEL = 'gpt-4-turbo'
    expect(resolveModel('grade')).toBe('gpt-4-turbo')
  })

  it('edge: a blank OPENAI_ANSWER_MODEL falls through to OPENAI_CHAT_MODEL and then gpt-4o', () => {
    process.env.OPENAI_ANSWER_MODEL = '   '
    process.env.OPENAI_CHAT_MODEL = 'gpt-4o-mini'
    expect(resolveModel('answer')).toBe('gpt-4o-mini')

    process.env.OPENAI_CHAT_MODEL = ''
    expect(resolveModel('answer')).toBe('gpt-4o')
  })

  it('edge: OPENAI_CHAT_MODEL still overrides the default', () => {
    process.env.OPENAI_CHAT_MODEL = 'gpt-4-turbo'
    expect(resolveModel('answer')).toBe('gpt-4-turbo')
    expect(resolveModel('sql')).toBe('gpt-4-turbo')
  })

  it('regression: the default model is gpt-4o and not gpt-4-turbo', () => {
    for (const role of ['answer', 'rewrite', 'grade', 'extraction', 'refine', 'condense', 'sql', 'faq', 'procurement'] as const) {
      expect(resolveModel(role)).not.toBe('gpt-4-turbo')
    }
  })

  it('happy: falls back to gpt-4o when nothing is set', () => {
    expect(resolveModel('answer')).toBe('gpt-4o')
    expect(resolveModel('extraction')).toBe('gpt-4o')
    expect(resolveModel('condense')).toBe('gpt-4o')
  })
})
