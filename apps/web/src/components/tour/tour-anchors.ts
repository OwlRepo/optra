// The single registry of `data-tour` anchors. Pages and nav items carry these
// attributes; tour-steps.ts targets them. The steps spec checks every target
// against this map, so a typo fails a test instead of stalling the tour.
export const TOUR_ANCHORS = {
  navOverview: 'nav-overview',
  navProcurement: 'nav-procurement',
  navDiscrepancies: 'nav-discrepancies',
  navCatalogMatches: 'nav-catalog-matches',
  navVendors: 'nav-vendors',
  navMembers: 'nav-members',
  navSettings: 'nav-settings',
  tabOverview: 'tab-overview',
  tabProcurement: 'tab-procurement',
  tabDiscrepancies: 'tab-discrepancies',
  procurementTabs: 'procurement-tabs',
  procurementUpload: 'procurement-upload',
  procurementUploadMobile: 'procurement-upload-mobile',
  procurementCompare: 'procurement-compare',
  discrepanciesStats: 'discrepancies-stats',
  discrepanciesFilter: 'discrepancies-filter',
  catalogActions: 'catalog-actions',
  vendorsAdd: 'vendors-add',
  overviewActivity: 'overview-activity',
  membersInvite: 'members-invite',
  settingsWorkspace: 'settings-workspace',
  sampleRun: 'sample-run',
  sampleFlag: 'sample-flag',
  sampleCitations: 'sample-citations',
  sampleVerify: 'sample-verify',
  sampleMatch: 'sample-match',
  replay: 'tour-replay',
} as const

export type TourAnchorId = (typeof TOUR_ANCHORS)[keyof typeof TOUR_ANCHORS]

export function tourAttr(id: TourAnchorId): { 'data-tour': TourAnchorId } {
  return { 'data-tour': id }
}

export function tourSelector(id: TourAnchorId): string {
  return `[data-tour="${id}"]`
}

const NAV_BY_SUFFIX: Record<string, TourAnchorId> = {
  '': TOUR_ANCHORS.navOverview,
  '/procurement': TOUR_ANCHORS.navProcurement,
  '/discrepancies': TOUR_ANCHORS.navDiscrepancies,
  '/catalog-matches': TOUR_ANCHORS.navCatalogMatches,
  '/vendors': TOUR_ANCHORS.navVendors,
  '/members': TOUR_ANCHORS.navMembers,
  '/settings': TOUR_ANCHORS.navSettings,
}

const TAB_BY_SUFFIX: Record<string, TourAnchorId> = {
  '': TOUR_ANCHORS.tabOverview,
  '/procurement': TOUR_ANCHORS.tabProcurement,
  '/discrepancies': TOUR_ANCHORS.tabDiscrepancies,
}

// Nav href -> anchor id; shared by WorkspaceNav ('nav') and MobileTabBar ('tab').
export function navAnchorFor(href: string, workspaceId: string, kind: 'nav' | 'tab'): TourAnchorId | undefined {
  const base = `/workspaces/${workspaceId}`
  if (href !== base && !href.startsWith(`${base}/`)) return undefined
  const suffix = href.slice(base.length)
  const map = kind === 'nav' ? NAV_BY_SUFFIX : TAB_BY_SUFFIX
  return Object.prototype.hasOwnProperty.call(map, suffix) ? map[suffix] : undefined
}
