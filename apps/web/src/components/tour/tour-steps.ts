import type { Step } from 'react-joyride'
import { TOUR_ANCHORS, tourSelector, type TourAnchorId } from './tour-anchors'

export type TourChapter = 'welcome' | 'core' | 'sample' | 'workspace' | 'finish'
export type SampleSection = 'compare' | 'photo'

export interface TourStepData {
  chapter: TourChapter
  /** Tap-to-advance: the tooltip hides the primary button. */
  interactive: boolean
  /** Pathname the `before` hook navigates to. */
  route?: string
  /** The sample stage is open, on this section. */
  sample?: SampleSection
}

export type TourStep = Step & { id: string; data: TourStepData }

export interface BuildTourStepsInput {
  workspaceId: string
  canManage: boolean
  isDesktop: boolean
  navigate: (href: string) => void
  waitFor?: (selector: string, timeoutMs: number) => Promise<void>
}

export const TOUR_TARGET_TIMEOUT_MS = 8000

const POLL_MS = 100

// Resolves as soon as the selector matches, or when the timeout passes: a miss is
// reported by Joyride itself as TARGET_NOT_FOUND, which the provider skips.
function waitForSelector(selector: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const tick = () => {
      if (document.querySelector(selector) || Date.now() - startedAt >= timeoutMs) {
        resolve()
        return
      }
      setTimeout(tick, POLL_MS)
    }
    tick()
  })
}

type Placement = NonNullable<Step['placement']>

interface Spec {
  id: string
  chapter: TourChapter
  title: string
  content: string
  /** Anchor to spotlight; omit for a centered step. */
  anchor?: TourAnchorId
  placement?: Placement
  route?: string
  sample?: SampleSection
  interactive?: boolean
  /** Fixed-position targets (sidebar, tab bar) need isFixed to stay anchored on scroll. */
  fixed?: boolean
}

export function buildTourSteps(input: BuildTourStepsInput): TourStep[] {
  const { workspaceId, canManage, isDesktop, navigate } = input
  const waitFor = input.waitFor ?? waitForSelector
  const base = `/workspaces/${workspaceId}`
  const routes = {
    overview: base,
    procurement: `${base}/procurement`,
    discrepancies: `${base}/discrepancies`,
    catalog: `${base}/catalog-matches`,
    vendors: `${base}/vendors`,
    members: `${base}/members`,
    settings: `${base}/settings`,
  }

  // Nav items live in the sidebar on desktop and in the tab bar below `lg`.
  // Where a tab exists the step points at it; where none does the step is dropped
  // and the next page step navigates.
  const navStep = (
    id: string,
    desktopAnchor: TourAnchorId,
    mobileAnchor: TourAnchorId | undefined,
    route: string,
    chapter: TourChapter,
    title: string,
    content: string,
  ): Spec | null => {
    const anchor = isDesktop ? desktopAnchor : mobileAnchor
    if (!anchor) return null
    return {
      id,
      chapter,
      title,
      content,
      anchor,
      route,
      fixed: true,
      placement: isDesktop ? 'right' : 'top',
    }
  }

  const gatedAnchor = (anchor: TourAnchorId): TourAnchorId | undefined => (canManage ? anchor : undefined)
  const uploadAnchor = isDesktop ? TOUR_ANCHORS.procurementUpload : TOUR_ANCHORS.procurementUploadMobile

  const specs: (Spec | null)[] = [
    {
      id: 'welcome',
      chapter: 'welcome',
      title: 'Welcome to Optra',
      content:
        'Optra checks every purchase order line against your vendor catalog, invoice and goods receipt, and flags what does not add up before you pay. This tour takes about three minutes. You can skip it at any time.',
    },

    navStep(
      'nav-procurement',
      TOUR_ANCHORS.navProcurement,
      TOUR_ANCHORS.tabProcurement,
      routes.procurement,
      'core',
      'Purchase orders',
      'Everything starts here. Your purchase orders, the invoices vendors send, and the goods receipts from your dock all live in this one place.',
    ),
    {
      id: 'procurement-tabs',
      chapter: 'core',
      title: 'Three documents, one match',
      content:
        'Purchase orders, invoices and goods receipts are the three documents Optra lines up. Each tab lists what you have uploaded and whether it has been read.',
      anchor: TOUR_ANCHORS.procurementTabs,
      route: routes.procurement,
      placement: 'bottom',
    },
    {
      id: 'procurement-upload',
      chapter: 'core',
      title: 'Upload a document',
      content: canManage
        ? 'Drop in a PO, invoice or receipt as a PDF, image or spreadsheet. Optra reads the lines for you. Nothing is uploaded during this tour.'
        : 'Owners and admins upload documents here. As a member you can open everything they add, review the discrepancies, and verify catalog matches.',
      anchor: gatedAnchor(uploadAnchor),
      route: routes.procurement,
      placement: 'bottom',
    },
    {
      id: 'procurement-compare',
      chapter: 'core',
      title: 'Compare in three steps',
      content:
        'Pick a purchase order, pick the invoice, then add the goods receipt. Run the comparison and Optra checks price and quantity line by line.',
      anchor: TOUR_ANCHORS.procurementCompare,
      route: routes.procurement,
      placement: 'top',
    },

    navStep(
      'nav-discrepancies',
      TOUR_ANCHORS.navDiscrepancies,
      TOUR_ANCHORS.tabDiscrepancies,
      routes.discrepancies,
      'core',
      'Discrepancies',
      'Every flag from every comparison lands here, so nothing gets paid before someone has looked at it.',
    ),
    {
      id: 'discrepancies-stats',
      chapter: 'core',
      title: 'See the money at risk',
      content: 'These totals show how many findings are open and how much they add up to, at a glance.',
      anchor: TOUR_ANCHORS.discrepanciesStats,
      route: routes.discrepancies,
      placement: 'bottom',
    },
    {
      id: 'discrepancies-filter',
      chapter: 'core',
      title: 'Review or dismiss',
      content: 'Filter by status, open a finding to read its citations, then review it or dismiss it with a reason.',
      anchor: TOUR_ANCHORS.discrepanciesFilter,
      route: routes.discrepancies,
      placement: 'bottom',
    },
    navStep(
      'nav-catalog-matches',
      TOUR_ANCHORS.navCatalogMatches,
      undefined,
      routes.catalog,
      'core',
      'Catalog matches',
      'Where PO lines are matched to your vendors’ catalog entries, photo included.',
    ),
    {
      id: 'catalog-actions',
      chapter: 'core',
      title: 'Filter, search and verify',
      content:
        'Filter matches by vendor and status. Open a PO line from a discrepancy to search every vendor, or verify against one. Every verdict shows its confidence and its evidence.',
      anchor: TOUR_ANCHORS.catalogActions,
      route: routes.catalog,
      placement: 'bottom',
    },
    navStep(
      'nav-vendors',
      TOUR_ANCHORS.navVendors,
      undefined,
      routes.vendors,
      'core',
      'Vendors',
      'Every supplier you buy from, with their catalogs and price history.',
    ),
    {
      id: 'vendors-add',
      chapter: 'core',
      title: 'Add a vendor',
      content: canManage
        ? 'Add a vendor, then open it to upload or scrape their catalog. Optra uses it as the source of truth for matching.'
        : 'Owners and admins add vendors. Open any vendor to browse their catalogs and price history.',
      anchor: gatedAnchor(TOUR_ANCHORS.vendorsAdd),
      route: routes.vendors,
      placement: 'bottom',
    },

    {
      id: 'sample-stage',
      chapter: 'sample',
      title: 'Now try it with sample data',
      content:
        'Here is a made-up example, not your workspace: purchase order PO-4417, invoice INV-8812 and goods receipt GRN-2203 from Northwind Fasteners. Nothing here is saved.',
      sample: 'compare',
    },
    {
      id: 'sample-run',
      chapter: 'sample',
      title: 'Run the comparison',
      content: 'All three documents are ready. Tap Run comparison and watch Optra match them line by line.',
      anchor: TOUR_ANCHORS.sampleRun,
      sample: 'compare',
      interactive: true,
      placement: 'bottom',
    },
    {
      id: 'sample-flag',
      chapter: 'sample',
      title: 'Two lines need attention',
      content: 'Optra found a price that went up and a delivery that came in short. Tap the price flag to see why.',
      anchor: TOUR_ANCHORS.sampleFlag,
      sample: 'compare',
      interactive: true,
      placement: 'bottom',
    },
    {
      id: 'sample-citations',
      chapter: 'sample',
      title: 'Every verdict has a citation',
      content:
        'Ordered, received and billed side by side, with the exact PO row, invoice line and receipt line behind the finding. You never have to take Optra’s word for it.',
      anchor: TOUR_ANCHORS.sampleCitations,
      sample: 'compare',
      placement: 'top',
    },
    {
      id: 'sample-photo',
      chapter: 'sample',
      title: 'Matching by photo',
      content:
        'Optra also compares what you asked for with the vendor’s catalog entry, including the product photo, so a look-alike part does not slip through.',
      sample: 'photo',
    },
    {
      id: 'sample-verify',
      chapter: 'sample',
      title: 'Verify the match',
      content: 'Tap Verify match to let Optra score the catalog photo against the request.',
      anchor: TOUR_ANCHORS.sampleVerify,
      sample: 'photo',
      interactive: true,
      placement: 'top',
    },
    {
      id: 'sample-match',
      chapter: 'sample',
      title: 'A confident match',
      content:
        'A high score with a Match verdict means the catalog entry fits the request. Lower scores are flagged for a person to decide.',
      anchor: TOUR_ANCHORS.sampleMatch,
      sample: 'photo',
      placement: 'top',
    },

    {
      id: 'overview-activity',
      chapter: 'workspace',
      title: 'Your activity feed',
      content: 'Overview shows what just happened in this workspace: uploads, comparisons and new findings.',
      anchor: TOUR_ANCHORS.overviewActivity,
      route: routes.overview,
      placement: 'top',
    },
    {
      id: 'members-invite',
      chapter: 'workspace',
      title: 'Invite your team',
      content: 'Add teammates by email. Owners and admins manage the workspace; members review and verify.',
      anchor: TOUR_ANCHORS.membersInvite,
      route: routes.members,
      placement: 'bottom',
    },
    {
      id: 'settings-workspace',
      chapter: 'workspace',
      title: 'Workspace settings',
      content: 'Rename the workspace and choose whether you get a weekly digest of open findings.',
      anchor: TOUR_ANCHORS.settingsWorkspace,
      route: routes.settings,
      placement: 'bottom',
    },

    {
      id: 'finish',
      chapter: 'finish',
      title: 'You are ready',
      content: 'Upload your first purchase order and invoice to see real findings. Replay this tour anytime from Take the tour.',
    },
  ]

  return specs
    .filter((spec): spec is Spec => spec !== null)
    .map((spec): TourStep => {
      const selector = spec.anchor ? tourSelector(spec.anchor) : 'body'
      const centered = selector === 'body'
      const interactive = spec.interactive === true
      const route = spec.route

      const step: TourStep = {
        id: spec.id,
        title: spec.title,
        content: spec.content,
        target: selector,
        placement: centered ? 'center' : (spec.placement ?? 'bottom'),
        skipBeacon: true,
        buttons: interactive ? ['skip'] : ['back', 'primary', 'skip'],
        isFixed: spec.fixed === true,
        targetWaitTimeout: TOUR_TARGET_TIMEOUT_MS,
        beforeTimeout: TOUR_TARGET_TIMEOUT_MS + 2000,
        data: { chapter: spec.chapter, interactive, route, sample: spec.sample },
      }

      if (route) {
        step.before = async () => {
          if (window.location.pathname !== route) navigate(route)
          if (!centered) await waitFor(selector, TOUR_TARGET_TIMEOUT_MS)
        }
      } else if (spec.sample && !centered) {
        // The sample stage mounts in the same commit that moves the tour here.
        step.before = () => waitFor(selector, TOUR_TARGET_TIMEOUT_MS)
      }
      return step
    })
}
