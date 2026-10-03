'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { ACTIONS, EVENTS, STATUS, type EventData } from 'react-joyride'
import { getCurrentUser } from '@/lib/api/auth'
import { listWorkspaces } from '@/lib/api/workspaces'
import { SampleStage } from './sample-stage'
import { readTourRecord, writeTourRecord, type TourStatus } from './tour-storage'
import { buildTourSteps, type TourStep } from './tour-steps'
import type { TourRunnerProps } from './tour-runner'

// Joyride only loads on workspace routes, and only once a tour has been started.
const TourRunner = dynamic<TourRunnerProps>(() => import('./tour-runner'), { ssr: false })

export interface TourContextValue {
  startTour: () => void
  isRunning: boolean
}

const TourContext = React.createContext<TourContextValue | null>(null)

export function useTour(): TourContextValue | null {
  return React.useContext(TourContext)
}

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

function roleOf(response: unknown, workspaceId: string): string | null {
  const items = (response as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return null
  const found = items.find((item) => (item as { id?: unknown } | null)?.id === workspaceId) as
    | { role?: unknown }
    | undefined
  return typeof found?.role === 'string' ? found.role : null
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
  const pendingStartRef = React.useRef(false)

  const begin = React.useCallback(() => {
    endedRef.current = false
    setIndex(0)
    setRunId((id) => id + 1)
    setRunnerMounted(true)
    setRun(true)
  }, [])

  // Who the viewer is and what they may do, once per workspace.
  React.useEffect(() => {
    setRun(false)
    setData(null)
    if (!workspaceId) return
    let cancelled = false
    void Promise.all([getCurrentUser(), listWorkspaces()])
      .then(([user, workspaces]) => {
        if (cancelled || !user?.userId) return
        const role = roleOf(workspaces, workspaceId)
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
  }, [workspaceId, begin])

  const steps = React.useMemo<TourStep[]>(
    () =>
      data
        ? buildTourSteps({
            workspaceId: data.workspaceId,
            canManage: data.canManage,
            isDesktop: data.isDesktop,
            navigate,
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
    if (userIdRef.current) writeTourRecord(userIdRef.current, status)
    setRun(false)
  }, [])

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

      if (event.type === EVENTS.TARGET_NOT_FOUND) {
        // A target that never shows must not strand the tour: move on.
        return goTo(event.action === ACTIONS.PREV ? event.index - 1 : event.index + 1)
      }
      if (event.type === EVENTS.STEP_AFTER) {
        if (event.action === ACTIONS.PREV) return goTo(event.index - 1)
        if (event.action === ACTIONS.NEXT || event.action === ACTIONS.CLOSE) return goTo(event.index + 1)
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

  const startTour = React.useCallback(() => {
    if (!workspaceId) return
    if (!data) {
      pendingStartRef.current = true
      return
    }
    begin()
  }, [begin, data, workspaceId])

  const value = React.useMemo<TourContextValue>(() => ({ startTour, isRunning: run }), [startTour, run])

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
        />
      ) : null}
      {workspaceId && data && runnerMounted ? (
        <TourRunner key={runId} run={run} stepIndex={index} steps={steps} onEvent={onEvent} />
      ) : null}
    </TourContext.Provider>
  )
}
