import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('DashboardPage', () => {
  it('shows a navigation link to workspaces', () => {
    const source = readFileSync(join(process.cwd(), 'app/dashboard/page.tsx'), 'utf8')
    expect(source).toContain('<Link href="/workspaces">Workspaces</Link>')
  })

  it('includes ticket usefulness-rate observability copy', () => {
    const source = readFileSync(join(process.cwd(), 'app/dashboard/page.tsx'), 'utf8')
    expect(source).toContain('Ticket usefulness rate')
    expect(source).toContain('Ticket copilot review quality')
  })
})
