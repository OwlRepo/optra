import { describe, expect, it } from 'vitest'
import { classifyQuery, classifyStructuredIntent, classifyTicketIntent } from './classify'

describe('classifyQuery (#7 simple vs complex routing)', () => {
  it('classifies short definitional questions as simple', () => {
    expect(classifyQuery('What is SSO?')).toBe('simple')
    expect(classifyQuery('Define webhook')).toBe('simple')
    expect(classifyQuery('who is the workspace owner')).toBe('simple')
  })

  it('classifies very short questions as simple', () => {
    expect(classifyQuery('pricing tiers?')).toBe('simple')
  })

  it('classifies troubleshooting questions as complex', () => {
    expect(classifyQuery('My file upload keeps failing with an error, how do I fix it?')).toBe(
      'complex',
    )
    expect(classifyQuery('why is my webhook not working')).toBe('complex')
  })

  it('classifies long procedural questions as complex', () => {
    expect(
      classifyQuery(
        'Walk me through configuring single sign-on with our identity provider and mapping roles',
      ),
    ).toBe('complex')
  })
})

describe('classifyStructuredIntent (structured/dataset routing candidate)', () => {
  it('matches aggregation and trend phrasing', () => {
    expect(classifyStructuredIntent('what is the total revenue last quarter')).toBe(true)
    expect(classifyStructuredIntent('average resolution time per agent')).toBe(true)
    expect(classifyStructuredIntent('which product had the highest sales')).toBe(true)
    expect(classifyStructuredIntent('compare Q1 sales vs Q1 refunds')).toBe(true)
  })

  it('does not match ordinary RAG-shaped questions', () => {
    expect(classifyStructuredIntent('how do I reset my password')).toBe(false)
    expect(classifyStructuredIntent('what is our refund policy')).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(classifyStructuredIntent('')).toBe(false)
    expect(classifyStructuredIntent('   ')).toBe(false)
  })
})

describe('classifyTicketIntent (tickets vs uploaded-dataset routing)', () => {
  it('matches ticket-specific phrasing', () => {
    expect(classifyTicketIntent('which ticket category rose last month')).toBe(true)
    expect(classifyTicketIntent('average resolution time per agent')).toBe(true)
    expect(classifyTicketIntent('breakdown by severity')).toBe(true)
  })

  it('does not match dataset-shaped questions', () => {
    expect(classifyTicketIntent('total revenue by product')).toBe(false)
    expect(classifyTicketIntent('compare Q1 sales vs Q1 refunds')).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(classifyTicketIntent('')).toBe(false)
  })
})
