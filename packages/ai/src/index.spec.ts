import { describe, expect, it } from 'vitest'

describe('@repo/ai barrel exports', () => {
  it('exports refineMessage and refine error classes from the chains/refine module', async () => {
    const mod = await import('./index')

    expect(typeof mod.refineMessage).toBe('function')
    expect(mod.RefineEmptyError).toBeDefined()
    expect(mod.RefineRefusalError).toBeDefined()
  })
})
