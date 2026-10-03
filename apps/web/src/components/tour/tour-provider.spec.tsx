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
})

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
    expect(screen.queryByRole('region', { name: 'Sample comparison' })).toBeNull()
    const sampleIndex = runner().steps.findIndex((s) => s.data.sample)
    expect(sampleIndex).toBeGreaterThan(0)

    emit({ type: EVENTS.STEP_AFTER, action: ACTIONS.NEXT, index: sampleIndex - 1, status: STATUS.RUNNING })

    expect(screen.getByTestId('tour-runner').getAttribute('data-step')).toBe(String(sampleIndex))
    expect(screen.getByRole('region', { name: 'Sample comparison' })).toBeDefined()
  })
})
