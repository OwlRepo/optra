import { describe, expect, it } from 'vitest'
import { TOUR_ANCHORS, navAnchorFor, tourAttr, tourSelector } from './tour-anchors'

const WS = 'ws-123'

describe('tour-anchors', () => {
  it.each(['knowledge-bases', 'datasets', 'chat', 'tickets', 'insights'])(
    'error: support-surfaces route /%s has no anchor in nav or tab',
    (segment) => {
      expect(navAnchorFor(`/workspaces/${WS}/${segment}`, WS, 'nav')).toBeUndefined()
      expect(navAnchorFor(`/workspaces/${WS}/${segment}`, WS, 'tab')).toBeUndefined()
    },
  )

  it('edge: an unknown href has no anchor', () => {
    expect(navAnchorFor('/somewhere/else', WS, 'nav')).toBeUndefined()
    expect(navAnchorFor('', WS, 'tab')).toBeUndefined()
  })

  it("edge: another workspace's href has no anchor", () => {
    expect(navAnchorFor('/workspaces/other/procurement', WS, 'nav')).toBeUndefined()
  })

  it('edge: tab kind only anchors the three tab-bar destinations', () => {
    expect(navAnchorFor(`/workspaces/${WS}/catalog-matches`, WS, 'tab')).toBeUndefined()
    expect(navAnchorFor(`/workspaces/${WS}/vendors`, WS, 'tab')).toBeUndefined()
    expect(navAnchorFor(`/workspaces/${WS}/members`, WS, 'tab')).toBeUndefined()
    expect(navAnchorFor(`/workspaces/${WS}/settings`, WS, 'tab')).toBeUndefined()
  })

  it('regression: anchor values are unique', () => {
    const values = Object.values(TOUR_ANCHORS)
    expect(new Set(values).size).toBe(values.length)
  })

  it.each([
    ['', 'nav-overview', 'tab-overview'],
    ['/procurement', 'nav-procurement', 'tab-procurement'],
    ['/discrepancies', 'nav-discrepancies', 'tab-discrepancies'],
  ])('happy: %s maps to the nav and tab anchors', (suffix, nav, tab) => {
    expect(navAnchorFor(`/workspaces/${WS}${suffix}`, WS, 'nav')).toBe(nav)
    expect(navAnchorFor(`/workspaces/${WS}${suffix}`, WS, 'tab')).toBe(tab)
  })

  it.each([
    ['/catalog-matches', 'nav-catalog-matches'],
    ['/vendors', 'nav-vendors'],
    ['/members', 'nav-members'],
    ['/settings', 'nav-settings'],
  ])('happy: %s maps to a nav anchor', (suffix, nav) => {
    expect(navAnchorFor(`/workspaces/${WS}${suffix}`, WS, 'nav')).toBe(nav)
  })

  it('happy: tourAttr and tourSelector agree', () => {
    expect(tourAttr(TOUR_ANCHORS.sampleRun)).toEqual({ 'data-tour': 'sample-run' })
    expect(tourSelector(TOUR_ANCHORS.replay)).toBe('[data-tour="tour-replay"]')
  })
})
