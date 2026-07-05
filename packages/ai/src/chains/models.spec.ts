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

  it('falls back to gpt-4-turbo when nothing is set', () => {
    expect(resolveModel('answer')).toBe('gpt-4-turbo')
    expect(resolveModel('extraction')).toBe('gpt-4-turbo')
    expect(resolveModel('condense')).toBe('gpt-4-turbo')
  })

  it('ignores empty/whitespace role values and falls through', () => {
    process.env.OPENAI_GRADE_MODEL = '   '
    process.env.OPENAI_CHAT_MODEL = 'gpt-4-turbo'
    expect(resolveModel('grade')).toBe('gpt-4-turbo')
  })
})
