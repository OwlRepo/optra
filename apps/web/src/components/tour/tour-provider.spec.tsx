/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { ACTIONS, EVENTS, STATUS } from 'react-joyride'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tourStorageKey, writeTourRecord } from './tour-storage'
import { TourProvider, useTour } from './tour-provider'

interface RunnerProps {
  run: boolean
  stepIndex: number
  steps: { id: string; data: { sample?: string; chapter: string } }[]
  onEvent: (data: Record<string, unknown>, controls?: unknown) => void
}

const mocks = vi.hoisted(() => ({
  pathname: '/workspaces/ws-1/procurement',
  push: vi.fn(),
  getCurrentUser: vi.fn(),
  listWorkspaces: vi.fn(),
  runner: { latest: null as unknown },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('@/lib/api/auth', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/api/workspaces', () => ({ listWorkspaces: mocks.listWorkspaces }))
vi.mock('next/dynamic', () => ({
  default: () =>
    function StubTourRunner(props: RunnerProps) {
      mocks.runner.latest = props
      return <div data-testid="tour-runner" data-run={String(props.run)} data-step={String(props.stepIndex)} />
    },
}))

const USER_ID = 'user-1'
const KEY = tourStorageKey(USER_ID)

function runner(): RunnerProps {
  return mocks.runner.latest as RunnerProps
}

function ReplayButton() {
  const tour = useTour()
  return (
    <button type="button" onClick={() => tour?.startTour()}>
      replay
    </button>
  )
}

function StageProbe() {
  const tour = useTour()
  return (
    <>
      <button type="button" onClick={() => tour?.performStageAction('sample-run')}>
        probe run
      </button>
      <button type="button" onClick={() => tour?.performStageAction('sample-flag')}>
        probe flag
      </button>
      <button type="button" onClick={() => tour?.performStageAction('welcome')}>
        probe other
      </button>
    </>
  )
}

function OpenerButton() {
  const tour = useTour()
  return (
    <button type="button" data-tour="tour-replay" onClick={(event) => tour?.startTour(event.currentTarget)}>
      Take the tour
    </button>
  )
}

function renderProvider() {
  return render(
    <TourProvider>
      <p>page content</p>
      <ReplayButton />
    </TourProvider>,
  )
}

async function started() {
  await waitFor(() => expect(screen.getByTestId('tour-runner').getAttribute('data-run')).toBe('true'))
}

function emit(data: Record<string, unknown>) {
  act(() => runner().onEvent(data, {}))
}

beforeEach(() => {
  window.localStorage.clear()
  mocks.runner.latest = null
  mocks.pathname = '/workspaces/ws-1/procurement'
  mocks.push.mockReset()
  mocks.getCurrentUser.mockReset().mockResolvedValue({ userId: USER_ID, email: 'a@b.c' })
  mocks.listWorkspaces.mockReset().mockResolvedValue({ items: [{ id: 'ws-1', name: 'W', role: 'owner' }] })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'matchMedia')
})

function stubReducedMotion() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
}

describe('TourProvider', () => {
  it('error: getCurrentUser rejecting does not auto-start, does not throw, and still renders children', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('401'))

    renderProvider()

    expect(screen.getByText('page content')).toBeDefined()
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalled())
    await act(async () => {})
    const el = screen.queryByTestId('tour-runner')
    expect(el === null || el.getAttribute('data-run') === 'false').toBe(true)
    expect(screen.getByText('page content')).toBeDefined()
  })

  it('error: listWorkspaces rejecting does not auto-start either', async () => {
    mocks.listWorkspaces.mockRejectedValue(new Error('500'))

    renderProvider()

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalled())
    await act(async () => {})
    const el = screen.queryByTestId('tour-runner')
    expect(el === null || el.getAttribute('data-run') === 'false').toBe(true)
    expect(screen.getByText('page content')).toBeDefined()
  })

  it('error: Esc (CLOSE) ends the tour as skipped instead of advancing', async () => {
    renderProvider()
    await started()

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.CLOSE, index: 1, status: STATUS.RUNNING })

    expect(JSON.parse(window.localStorage.getItem(KEY) as string).status).toBe('skipped')
    expect(screen.getByTestId('tour-runner').getAttribute('data-run')).toBe('false')
    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe('0')
  })

  it('error: an EVENTS.ERROR (failed before hook) advances one step like a missing target', async () => {
    renderProvider()
    await started()

    emit({ type: EVENTS.ERROR, index: 2, action: ACTIONS.NEXT, status: STATUS.RUNNING })

    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe('3')
  })

  it('error: leaving the workspace mid-tour writes a skipped record', async () => {
    const view = renderProvider()
    await started()

    mocks.pathname = '/workspaces'
    view.rerender(
      <TourProvider>
        <p>page content</p>
        <ReplayButton />
      </TourProvider>,
    )

    expect(JSON.parse(window.localStorage.getItem(KEY) as string).status).toBe('skipped')
  })

  it.each(['/workspaces', '/workspaces/new', '/login', '/'])(
    'edge: on %s renders only children and makes no fetch',
    async (pathname) => {
      mocks.pathname = pathname

      renderProvider()
      await act(async () => {})

      expect(screen.getByText('page content')).toBeDefined()
      expect(screen.queryByTestId('tour-runner')).toBeNull()
      expect(mocks.getCurrentUser).not.toHaveBeenCalled()
      expect(mocks.listWorkspaces).not.toHaveBeenCalled()
    },
  )

  it('edge: leaving the workspace after the tour finished keeps the completed record', async () => {
    const view = renderProvider()
    await started()
    emit({ type: EVENTS.TOUR_END, status: STATUS.FINISHED, action: ACTIONS.NEXT, index: runner().steps.length - 1 })

    mocks.pathname = '/workspaces'
    view.rerender(
      <TourProvider>
        <p>page content</p>
      </TourProvider>,
    )

    expect(JSON.parse(window.localStorage.getItem(KEY) as string).status).toBe('completed')
  })

  it('edge: a TARGET_NOT_FOUND going back moves one step back', async () => {
    renderProvider()
    await started()
    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.NEXT, index: 0, status: STATUS.RUNNING })
    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.NEXT, index: 1, status: STATUS.RUNNING })

    emit({ type: EVENTS.TARGET_NOT_FOUND, index: 2, action: ACTIONS.PREV, status: STATUS.RUNNING })

    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe('1')
  })

  it('edge: performStageAction drives the sample stage and advances the tour', async () => {
    stubReducedMotion()
    render(
      <TourProvider>
        <StageProbe />
      </TourProvider>,
    )
    await started()
    const runIndex = runner().steps.findIndex((s) => s.id === 'sample-run')
    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.NEXT, index: runIndex - 1, status: STATUS.RUNNING })
    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe(String(runIndex))

    act(() => screen.getByRole('button', { name: 'probe run' }).click())
    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe(String(runIndex + 1))

    act(() => screen.getByRole('button', { name: 'probe flag' }).click())
    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe(String(runIndex + 2))
  })

  it('edge: performStageAction for a step that is not the current stage step does nothing', async () => {
    render(
      <TourProvider>
        <StageProbe />
      </TourProvider>,
    )
    await started()

    act(() => screen.getByRole('button', { name: 'probe other' }).click())
    act(() => screen.getByRole('button', { name: 'probe run' }).click())

    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe('0')
  })

  it('edge: ending the tour returns focus to the Take the tour button that opened it', async () => {
    writeTourRecord(USER_ID, 'completed')
    render(
      <TourProvider>
        <main>content</main>
        <OpenerButton />
      </TourProvider>,
    )
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalled())
    await act(async () => {})
    const opener = screen.getByRole('button', { name: 'Take the tour' })
    act(() => opener.click())
    await started()

    emit({ type: EVENTS.TOUR_END, status: STATUS.SKIPPED, action: ACTIONS.SKIP, index: 1 })

    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('edge: ending an auto-started tour moves focus to main', async () => {
    render(
      <TourProvider>
        <main>content</main>
        <OpenerButton />
      </TourProvider>,
    )
    await started()

    emit({ type: EVENTS.TOUR_END, status: STATUS.SKIPPED, action: ACTIONS.SKIP, index: 1 })

    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('main')))
  })

  it('edge: a stored record means no auto-start', async () => {
    writeTourRecord(USER_ID, 'completed')

    renderProvider()

    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalled())
    await act(async () => {})
    const el = screen.queryByTestId('tour-runner')
    expect(el === null || el.getAttribute('data-run') === 'false').toBe(true)
  })

  it('edge: useTour is null outside the provider', () => {
    let value: unknown = 'unset'
    function Probe() {
      value = useTour()
      return null
    }
    render(<Probe />)
    expect(value).toBeNull()
  })

  it('edge: a TARGET_NOT_FOUND event advances one step instead of sticking', async () => {
    renderProvider()
    await started()

    emit({ type: EVENTS.TARGET_NOT_FOUND, index: 0, action: ACTIONS.NEXT, status: STATUS.RUNNING })

    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe('1')
  })

  it('regression: the member role is read from listWorkspaces (member gets center upload step)', async () => {
    mocks.listWorkspaces.mockResolvedValue({ items: [{ id: 'ws-1', name: 'W', role: 'member' }] })

    renderProvider()
    await started()

    const upload = runner().steps.find((s) => s.id.startsWith('procurement-upload')) as unknown as { target: string }
    expect(upload.target).toBe('body')
  })

  it('happy: first visit auto-starts at step 0', async () => {
    renderProvider()

    await started()

    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe('0')
    expect(runner().steps.length).toBeGreaterThan(5)
  })

  it('happy: finishing writes a completed record', async () => {
    renderProvider()
    await started()

    emit({ type: EVENTS.TOUR_END, status: STATUS.FINISHED, action: ACTIONS.NEXT, index: runner().steps.length - 1 })

    const record = JSON.parse(window.localStorage.getItem(KEY) as string)
    expect(record.status).toBe('completed')
    expect(typeof record.at).toBe('string')
    expect(screen.getByTestId('tour-runner').getAttribute('data-run')).toBe('false')
  })

  it('happy: skipping writes a skipped record', async () => {
    renderProvider()
    await started()

    emit({ type: EVENTS.TOUR_END, status: STATUS.SKIPPED, action: ACTIONS.SKIP, index: 2 })

    expect(JSON.parse(window.localStorage.getItem(KEY) as string).status).toBe('skipped')
  })

  it('happy: startTour replays from step 0 after completion', async () => {
    writeTourRecord(USER_ID, 'completed')
    renderProvider()
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalled())
    await act(async () => {})

    act(() => screen.getByRole('button', { name: 'replay' }).click())

    await started()
    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe('0')
  })

  it('happy: a step with data.sample renders the SampleStage region', async () => {
    renderProvider()
    await started()
    expect(screen.queryByRole('region', { name: /sample data/i })).toBeNull()
    const sampleIndex = runner().steps.findIndex((s) => s.data.sample)
    expect(sampleIndex).toBeGreaterThan(0)

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.NEXT, index: sampleIndex - 1, status: STATUS.RUNNING })

    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe(String(sampleIndex))
    expect(screen.getByRole('region', { name: /sample data/i })).toBeDefined()
  })
})
