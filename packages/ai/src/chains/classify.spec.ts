import { describe, expect, it } from 'vitest'
import { classifyQuery } from './classify'

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
