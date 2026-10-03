'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { ACTIONS, EVENTS, STATUS, type EventData } from 'react-joyride'
import { getCurrentUser } from '@/lib/api/auth'
import { getWorkspace } from '@/lib/api/workspaces'
import { membershipFrom } from '@/lib/workspace-role'
import { SampleStage, type SampleStageActions } from './sample-stage'
import { TourContext, useTour, type TourContextValue } from './tour-context'
import { readTourRecord, writeTourRecord, type TourStatus } from './tour-storage'
import { buildTourSteps, type TourStep } from './tour-steps'
import type { TourRunnerProps } from './tour-runner'

// Joyride only loads on workspace routes, and only once a tour has been started.
const TourRunner = dynamic<TourRunnerProps>(() => import('./tour-runner'), { ssr: false })

export { useTour }
export type { TourContextValue }

// The list at /workspaces and the create page at /workspaces/new are not workspaces.
const WORKSPACE_ROUTE = /^\/workspaces\/(?!new(?:\/|$))([^/]+)/

interface TourContextData {
  workspaceId: string
  userId: string
  canManage: boolean
  isDesktop: boolean
}

function workspaceIdFrom(pathname: string | null): string | null {
  const match = pathname ? WORKSPACE_ROUTE.exec(pathname) : null
  return match ? match[1] : null
}

function readIsDesktop(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(min-width: 1024px)').matches
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const workspaceId = workspaceIdFrom(pathname)

  const [data, setData] = React.useState<TourContextData | null>(null)
  const [run, setRun] = React.useState(false)
  const [index, setIndex] = React.useState(0)
  const [runId, setRunId] = React.useState(0)
  const [runnerMounted, setRunnerMounted] = React.useState(false)

  const navigateRef = React.useRef<(href: string) => void>(() => undefined)
  navigateRef.current = (href) => router.push(href)
  const navigate = React.useCallback((href: string) => navigateRef.current(href), [])

  const endedRef = React.useRef(false)
  const runningRef = React.useRef(false)
  const pendingStartRef = React.useRef(false)
  const pendingOpenerRef = React.useRef<HTMLElement | null>(null)
  const openerRef = React.useRef<HTMLElement | null>(null)
  const stageActionsRef = React.useRef<SampleStageActions | null>(null)

  const begin = React.useCallback(() => {
    endedRef.current = false
    runningRef.current = true
    openerRef.current = pendingOpenerRef.current
    pendingOpenerRef.current = null
    setIndex(0)
    setRunId((id) => id + 1)
    setRunnerMounted(true)
    setRun(true)
  }, [])

  const steps = React.useMemo<TourStep[]>(
    () =>
      data
        ? buildTourSteps({
            workspaceId: data.workspaceId,
            canManage: data.canManage,
            isDesktop: data.isDesktop,
            navigate,
            isActive: () => !endedRef.current,
          })
        : [],
    [data, navigate],
  )

  const stepsRef = React.useRef(steps)
  stepsRef.current = steps
  const indexRef = React.useRef(index)
  indexRef.current = index
  const userIdRef = React.useRef<string | null>(null)
  userIdRef.current = data?.userId ?? null

  const end = React.useCallback((status: TourStatus) => {
    if (endedRef.current) return
    endedRef.current = true
    runningRef.current = false
    if (userIdRef.current) writeTourRecord(userIdRef.current, status)
    setRun(false)

    // Joyride's focus trap is gone once the tour stops; hand focus back to the
    // control that opened it, else to the page's main landmark.
    const opener = openerRef.current
    openerRef.current = null
    window.setTimeout(() => {
      if (opener && opener.isConnected) {
        opener.focus()
        return
      }
      const main = document.querySelector<HTMLElement>('main')
      if (!main) return
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
      main.focus()
    }, 0)
  }, [])

  // Who the viewer is and what they may do, once per workspace.
  React.useEffect(() => {
    // Leaving the workspace mid-tour counts as skipping it.
    if (runningRef.current) end('skipped')
    setRun(false)
    setData(null)
    if (!workspaceId) return
    let cancelled = false
    // Same role source as the pages (GET /workspaces/:id), so the tour's
    // manager steps always agree with the controls on screen.
    void Promise.all([getCurrentUser(), getWorkspace(workspaceId)])
      .then(([user, workspace]) => {
        if (cancelled || !user?.userId) return
        const role = membershipFrom(workspace)?.role ?? null
        setData({
          workspaceId,
          userId: user.userId,
          canManage: role === 'owner' || role === 'admin',
          isDesktop: readIsDesktop(),
        })
        if (pendingStartRef.current || readTourRecord(user.userId) === null) {
          pendingStartRef.current = false
          begin()
        }
      })
      .catch(() => {
        // No identity, no tour: never block the page for an onboarding aid.
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, begin, end])

  const goTo = React.useCallback(
    (next: number) => {
      if (next >= stepsRef.current.length) {
        end('completed')
        return
      }
      setIndex(Math.max(0, next))
    },
    [end],
  )

  const onEvent = React.useCallback(
    (event: Pick<EventData, 'type' | 'status' | 'action' | 'index'>) => {
      if (event.status === STATUS.FINISHED) return end('completed')
      if (event.status === STATUS.SKIPPED) return end('skipped')
      // Esc (and any other close) ends the tour; it never advances a step.
      if (event.action === ACTIONS.CLOSE) return end('skipped')

      if (event.type === EVENTS.TARGET_NOT_FOUND || event.type === EVENTS.ERROR) {
        // A target that never shows, or a before hook that throws, must not strand the tour: move on.
        return goTo(event.action === ACTIONS.PREV ? event.index - 1 : event.index + 1)
      }
      if (event.type === EVENTS.STEP_AFTER) {
        if (event.action === ACTIONS.PREV) return goTo(event.index - 1)
        if (event.action === ACTIONS.NEXT) return goTo(event.index + 1)
      }
    },
    [end, goTo],
  )

  // The interactive steps advance when the viewer taps the real control.
  const advanceFrom = React.useCallback(
    (stepId: string) => {
      if (stepsRef.current[indexRef.current]?.id === stepId) goTo(indexRef.current + 1)
    },
    [goTo],
  )

  const startTour = React.useCallback(
    (opener?: HTMLElement | null) => {
      if (!workspaceId) return
      pendingOpenerRef.current = opener ?? null
      if (!data) {
        pendingStartRef.current = true
        return
      }
      begin()
    },
    [begin, data, workspaceId],
  )

  const performStageAction = React.useCallback((stepId: string) => {
    if (stepsRef.current[indexRef.current]?.id !== stepId) return
    const actions = stageActionsRef.current
    if (!actions) return
    if (stepId === 'sample-run') actions.run()
    else if (stepId === 'sample-flag') actions.openFlag()
    else if (stepId === 'sample-verify') actions.verify()
  }, [])

  const setStageActions = React.useCallback((actions: SampleStageActions | null) => {
    stageActionsRef.current = actions
  }, [])

  const value = React.useMemo<TourContextValue>(
    () => ({ startTour, isRunning: run, performStageAction }),
    [startTour, run, performStageAction],
  )

  const current = steps[index]
  const sampleSection = run ? current?.data.sample : undefined

  return (
    <TourContext.Provider value={value}>
      {children}
      {workspaceId && sampleSection ? (
        <SampleStage
          key={sampleSection}
          section={sampleSection}
          onRunComplete={() => advanceFrom('sample-run')}
          onFlagOpened={() => advanceFrom('sample-flag')}
          onVerified={() => advanceFrom('sample-verify')}
          onActionsReady={setStageActions}
        />
      ) : null}
      {workspaceId && data && runnerMounted ? (
        <TourRunner key={runId} run={run} stepIndex={index} steps={steps} onEvent={onEvent} />
      ) : null}
    </TourContext.Provider>
  )
}
