import { describe, expect, it } from 'vitest'

// [support-surfaces-off] 2026-10-02: the Knowledge Bases, Datasets, Chat,
// Tickets and Insights routes are disabled by a notFound() line in each
// route's layout.tsx. On re-enable, comment those lines out and delete this spec.

const LAYOUTS = [
  ['knowledge-bases', () => import('./knowledge-bases/layout')],
  ['datasets', () => import('./datasets/layout')],
  ['chat', () => import('./chat/layout')],
  ['tickets', () => import('./tickets/layout')],
  ['insights', () => import('./insights/layout')],
] as const

describe('disabled support-surface routes', () => {
  for (const [segment, load] of LAYOUTS) {
    it(`error: /workspaces/:id/${segment} answers 404 through notFound()`, async () => {
      const { default: Layout } = await load()

      expect(() => Layout({ children: null })).toThrow('NEXT_NOT_FOUND')
    })
  }
})
