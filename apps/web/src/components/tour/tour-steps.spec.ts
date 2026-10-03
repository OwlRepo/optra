/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOUR_ANCHORS, tourSelector } from './tour-anchors'
import { TOUR_TARGET_TIMEOUT_MS, buildTourSteps, type TourChapter, type TourStep } from './tour-steps'

const WS = 'ws-123'
const SUPPORT_SURFACES = /knowledge-bases|datasets|chat|tickets|insights/
const ANCHOR_SELECTORS = new Set(Object.values(TOUR_ANCHORS).map((id) => tourSelector(id)))
const CHAPTER_ORDER: TourChapter[] = ['welcome', 'core', 'sample', 'workspace', 'finish']

function build(overrides: Partial<Parameters<typeof buildTourSteps>[0]> = {}) {
  const navigate = vi.fn()
  const waitFor = vi.fn().mockResolvedValue(undefined)
  const steps = buildTourSteps({ workspaceId: WS, canManage: true, isDesktop: true, navigate, waitFor, ...overrides })
  return { steps, navigate, waitFor }
}

function targetOf(step: TourStep): string {
  return typeof step.target === 'string' ? step.target : ''
}

afterEach(() => {
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
})

describe('buildTourSteps', () => {
  it.each([
    ['owner desktop', { canManage: true, isDesktop: true }],
    ['member desktop', { canManage: false, isDesktop: true }],
    ['owner mobile', { canManage: true, isDesktop: false }],
    ['member mobile', { canManage: false, isDesktop: false }],
  ])('error: %s - no step route or target hits a support surface', (_label, overrides) => {
    const { steps } = build(overrides)
    for (const step of steps) {
      expect(step.data.route ?? '').not.toMatch(SUPPORT_SURFACES)
      expect(targetOf(step)).not.toMatch(SUPPORT_SURFACES)
    }
  })

  it('error: the default waitFor stops polling once the tour is no longer active', async () => {
    vi.useFakeTimers()
    let active = true
    const { steps } = build({ waitFor: undefined, isActive: () => active })
    const step = steps.find((s) => s.id === 'procurement-tabs') as TourStep
    window.history.pushState({}, '', step.data.route as string)

    const pending = step.before?.({} as never)
    await vi.advanceTimersByTimeAsync(300)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    active = false
    await vi.advanceTimersByTimeAsync(200)
    await pending

    expect(vi.getTimerCount()).toBe(0)
  })

  it('edge: a member gets centered explanations for upload and add vendor, with the same ids', () => {
    const owner = build({ canManage: true }).steps
    const member = build({ canManage: false }).steps
    const isGated = (step: TourStep) => /^procurement-upload|^vendors-add/.test(step.id)

    const gatedOwner = owner.filter(isGated)
    const gatedMember = member.filter(isGated)

    expect(gatedOwner.length).toBeGreaterThan(0)
    expect(gatedMember.map((s) => s.id)).toEqual(gatedOwner.map((s) => s.id))
    for (const step of gatedMember) {
      expect(step.target).toBe('body')
      expect(step.placement).toBe('center')
    }
    for (const step of gatedOwner) {
      expect(step.target).not.toBe('body')
    }
    expect(member.length).toBe(owner.length)
  })

  it('edge: on mobile nav steps use tab-* anchors and the rest are dropped', () => {
    const { steps } = build({ isDesktop: false })
    const targets = steps.map(targetOf)

    expect(targets.some((t) => t.includes('data-tour="nav-'))).toBe(false)
    expect(targets).toContain(tourSelector(TOUR_ANCHORS.tabProcurement))
    expect(targets).toContain(tourSelector(TOUR_ANCHORS.tabDiscrepancies))
    // No tab exists for these, so no step may point at the (hidden) sidebar item.
    expect(targets).not.toContain(tourSelector(TOUR_ANCHORS.navCatalogMatches))
    expect(targets).not.toContain(tourSelector(TOUR_ANCHORS.navVendors))
    expect(steps.length).toBeLessThan(build({ isDesktop: true }).steps.length)
  })

  it('edge: on desktop nav steps use nav-* anchors, never tab-*', () => {
    const targets = build({ isDesktop: true }).steps.map(targetOf)
    expect(targets.some((t) => t.includes('data-tour="tab-'))).toBe(false)
    expect(targets).toContain(tourSelector(TOUR_ANCHORS.navProcurement))
  })

  it('edge: before skips navigate when the page is already on the step route', async () => {
    const { steps, navigate, waitFor } = build()
    const step = steps.find((s) => s.data.route && s.target !== 'body') as TourStep
    window.history.pushState({}, '', step.data.route as string)

    await step.before?.({} as never)

    expect(navigate).not.toHaveBeenCalled()
    expect(waitFor).toHaveBeenCalledWith(step.target, TOUR_TARGET_TIMEOUT_MS)
  })

  it('edge: before navigates then waits for the target when elsewhere', async () => {
    const { steps, navigate, waitFor } = build()
    const step = steps.find((s) => s.data.route && s.target !== 'body') as TourStep
    window.history.pushState({}, '', `/workspaces/${WS}/members-elsewhere`)
    const order: string[] = []
    navigate.mockImplementation(() => order.push('navigate'))
    waitFor.mockImplementation(async () => void order.push('waitFor'))

    await step.before?.({} as never)

    expect(navigate).toHaveBeenCalledWith(step.data.route)
    expect(order).toEqual(['navigate', 'waitFor'])
  })

  it.each([
    [true, 'Click'],
    [false, 'Tap'],
  ])('edge: isDesktop=%s - interactive copy says "%s" and carries the action button label and hint', (isDesktop, verb) => {
    const { steps } = build({ isDesktop })
    const byId = (id: string) => steps.find((s) => s.id === id) as TourStep

    expect(byId('sample-run').content).toContain(`${verb} Run comparison`)
    expect(byId('sample-flag').content).toContain(`${verb} the price flag`)
    expect(byId('sample-verify').content).toContain(`${verb} Verify match`)
    expect(byId('sample-run').data.actionLabel).toBe('Run comparison')
    expect(byId('sample-flag').data.actionLabel).toBe('Open price flag')
    expect(byId('sample-verify').data.actionLabel).toBe('Verify match')
    for (const id of ['sample-run', 'sample-flag', 'sample-verify']) {
      expect(byId(id).data.hint).toBe(`${verb} the highlighted control or use the button`)
    }
    for (const step of steps.filter((s) => !s.data.interactive)) {
      expect(step.data.actionLabel).toBeUndefined()
    }
  })

  it('regression: the default waitFor ignores the old page copy of a target until the route has changed and the new copy is stable', async () => {
    // Every workspace page mounts its own AppShell, so the nav anchor exists on
    // the page being left AND the page being opened. Resolving on the old copy
    // pinned the tooltip to a detached element at the top-left corner.
    vi.useFakeTimers()
    const step = build({ waitFor: undefined }).steps.find((s) => s.id === 'nav-discrepancies') as TourStep
    const route = step.data.route as string
    const selector = targetOf(step)
    const anchor = selector.match(/data-tour="([^"]+)"/)?.[1] as string
    const oldCopy = document.createElement('a')
    oldCopy.setAttribute('data-tour', anchor)
    document.body.appendChild(oldCopy)
    window.history.pushState({}, '', `/workspaces/${WS}/procurement`)

    let resolved = false
    const pending = Promise.resolve(step.before?.({} as never)).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(resolved).toBe(false)

    window.history.pushState({}, '', route)
    oldCopy.remove()
    const newCopy = document.createElement('a')
    newCopy.setAttribute('data-tour', anchor)
    document.body.appendChild(newCopy)
    await vi.advanceTimersByTimeAsync(1000)
    await pending

    expect(resolved).toBe(true)
    expect(document.querySelector(selector)).toBe(newCopy)
    newCopy.remove()
  })

  it('edge: no Back from the sample stage through the first step after it; other steps keep Back', () => {
    const { steps } = build()
    const noBack = ['sample-stage', 'sample-run', 'sample-flag', 'sample-citations', 'sample-photo', 'sample-verify', 'sample-match', 'overview-activity']

    for (const step of steps) {
      if (noBack.includes(step.id)) {
        expect(step.data.canGoBack).toBe(false)
        expect(step.buttons).not.toContain('back')
        if (!step.data.interactive) expect(step.buttons).toEqual(['primary', 'skip'])
      } else if (!step.data.interactive) {
        expect(step.data.canGoBack).toBe(true)
        expect(step.buttons).toContain('back')
      }
    }
  })

  it('edge: page steps name their destination for the loader', () => {
    const { steps } = build()
    const byId = (id: string) => steps.find((s) => s.id === id) as TourStep

    expect(byId('discrepancies-stats').data.loaderLabel).toBe('Opening Discrepancies…')
    expect(byId('procurement-tabs').data.loaderLabel).toBe('Opening Purchase orders…')
    for (const step of steps.filter((s) => s.data.route)) {
      expect(step.data.loaderLabel).toMatch(/^Opening .+…$/)
    }
  })

  it('regression: copy only claims what the product does', () => {
    const owner = build({ canManage: true }).steps
    const text = (id: string) => (owner.find((s) => s.id === id) as TourStep).content as string

    expect(text('welcome')).not.toMatch(/minutes/i)
    // Procurement accepts PDF, XLSX and CSV for POs and invoices, spreadsheets only for receipts. No images.
    expect(text('procurement-upload')).not.toMatch(/image|photo/i)
    expect(text('procurement-upload')).toMatch(/PDF/)
    expect(text('procurement-upload')).toMatch(/spreadsheet/)
    // Review records an outcome decision; dismiss takes no reason.
    expect(text('discrepancies-filter')).not.toMatch(/reason/i)
    expect(text('discrepancies-filter')).toMatch(/false positive/i)
    expect(text('discrepancies-filter')).toMatch(/approved exception/i)
  })

  it('regression: the price-flag tooltip never opens below the flag, where it hid the other two result rows', () => {
    for (const isDesktop of [true, false]) {
      const flag = build({ isDesktop }).steps.find((s) => s.id === 'sample-flag') as TourStep
      expect(flag.placement).not.toBe('bottom')
    }
  })

  it('regression: only sample-run, sample-flag and sample-verify are interactive, with a skip-only button set', () => {
    const { steps } = build()
    const interactive = steps.filter((s) => s.data.interactive)

    expect(interactive.map((s) => s.id)).toEqual(['sample-run', 'sample-flag', 'sample-verify'])
    for (const step of interactive) {
      expect(step.buttons).toEqual(['skip'])
    }
    for (const step of steps.filter((s) => !s.data.interactive)) {
      expect(step.buttons).not.toEqual(['skip'])
    }
  })

  it('regression: sample steps carry the sample section and sit between core and workspace', () => {
    const { steps } = build()
    const withSample = steps.filter((s) => s.data.sample)
    expect(withSample.length).toBeGreaterThan(0)
    expect(withSample.every((s) => s.data.chapter === 'sample')).toBe(true)
    expect(steps.find((s) => s.id === 'sample-run')?.data.sample).toBe('compare')
    expect(steps.find((s) => s.id === 'sample-verify')?.data.sample).toBe('photo')
  })

  it('happy: chapters run welcome, core, sample, workspace, finish in order', () => {
    const { steps } = build()
    const chapters = steps.map((s) => s.data.chapter)
    const firstSeen = CHAPTER_ORDER.map((c) => chapters.indexOf(c))

    expect(firstSeen.every((i) => i >= 0)).toBe(true)
    expect([...firstSeen].sort((a, b) => a - b)).toEqual(firstSeen)
    // Never goes backwards.
    const ranks = chapters.map((c) => CHAPTER_ORDER.indexOf(c))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(steps[0].data.chapter).toBe('welcome')
    expect(steps[steps.length - 1].data.chapter).toBe('finish')
  })

  it.each([
    ['desktop owner', { isDesktop: true, canManage: true }],
    ['mobile member', { isDesktop: false, canManage: false }],
  ])('happy: %s - unique ids, registered targets, skipBeacon everywhere', (_label, overrides) => {
    const { steps } = build(overrides)

    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
    for (const step of steps) {
      const target = targetOf(step)
      if (target === 'body') {
        expect(step.placement).toBe('center')
      } else {
        expect(ANCHOR_SELECTORS.has(target)).toBe(true)
      }
      expect(step.skipBeacon).toBe(true)
    }
  })
})
