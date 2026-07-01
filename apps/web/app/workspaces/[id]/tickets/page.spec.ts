/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import TicketsPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const listTicketsMock = vi.fn()
const createTicketMock = vi.fn()
const getTicketMock = vi.fn()
const updateTicketMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/tickets', () => ({
  listTickets: (...args: unknown[]) => listTicketsMock(...args),
  createTicket: (...args: unknown[]) => createTicketMock(...args),
  getTicket: (...args: unknown[]) => getTicketMock(...args),
  updateTicket: (...args: unknown[]) => updateTicketMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(TicketsPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('TicketsPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    listTicketsMock.mockReset()
    createTicketMock.mockReset()
    getTicketMock.mockReset()
    updateTicketMock.mockReset()
    logoutMock.mockReset()
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('creates ticket, polls while pending, then renders done detail', async () => {
    let pollCallback: TimerHandler | undefined
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation(((fn: TimerHandler) => {
        pollCallback = fn
        return 1 as unknown as number
      }) as typeof window.setInterval)
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined)
    listTicketsMock
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [{ id: 'ticket-1', title: null, status: 'pending', severity: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' }],
        nextCursor: null,
      })
      .mockResolvedValue({
        items: [{ id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' }],
        nextCursor: null,
      })
    getTicketMock
      .mockResolvedValueOnce({
        id: 'ticket-1',
        transcript: 'OTP transcript',
        title: null,
        issueSummary: null,
        reproSteps: null,
        severity: null,
        productArea: 'general',
        hypothesizedRootCause: null,
        nextAction: null,
        status: 'pending',
        fieldConfidence: {},
      })
      .mockResolvedValue({
        id: 'ticket-1',
        transcript: 'OTP transcript',
        title: 'OTP login loop',
        issueSummary: 'Users loop back to login.',
        reproSteps: '1. Verify OTP',
        severity: 'high',
        productArea: 'auth',
        hypothesizedRootCause: 'Cookie missing',
        nextAction: 'Trace cookie write',
        status: 'done',
        fieldConfidence: {
          title: 0.9,
          issueSummary: 0.9,
          reproSteps: 0.8,
          severity: 0.8,
          productArea: 0.8,
          hypothesizedRootCause: 0.7,
          nextAction: 0.8,
        },
      })
    createTicketMock.mockResolvedValue({ id: 'ticket-1', status: 'pending' })

    renderPage()

    fireEvent.change(screen.getByLabelText('Transcript'), {
      target: { value: 'Customer says OTP verify loops back to login.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Extract ticket' }))

    await waitFor(() => {
      expect(createTicketMock).toHaveBeenCalledWith('ws-1', {
        transcript: 'Customer says OTP verify loops back to login.',
      })
    })
    await waitFor(() => {
      expect(screen.getByText('pending')).toBeDefined()
    })

    expect(setIntervalSpy).toHaveBeenCalled()
    expect(typeof pollCallback).toBe('function')
    await (pollCallback as () => void)()
    await Promise.resolve()
    await waitFor(() => {
      expect(screen.getByDisplayValue('OTP login loop')).toBeDefined()
      expect(screen.getByDisplayValue('Users loop back to login.')).toBeDefined()
    })
  })

  it('edits ticket, records feedback, and copies Linear markdown', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      nextCursor: null,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'OTP transcript',
      title: 'OTP login loop',
      issueSummary: 'Users loop back to login.',
      reproSteps: '1. Verify OTP',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'Cookie missing',
      nextAction: 'Trace cookie write',
      status: 'done',
      usefulness: null,
      editState: null,
      feedbackNote: null,
      fieldConfidence: {
        title: 0.9,
        issueSummary: 0.9,
        reproSteps: 0.8,
        severity: 0.8,
        productArea: 0.8,
        hypothesizedRootCause: 0.7,
        nextAction: 0.8,
      },
    })
    updateTicketMock.mockResolvedValue({
      id: 'ticket-1',
      title: 'OTP verification login loop',
      issueSummary: 'Users loop back to login.',
      reproSteps: '1. Verify OTP',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'Cookie missing',
      nextAction: 'Trace cookie write',
      usefulness: 'useful',
      editState: 'accepted',
      feedbackNote: 'Ready for Linear',
      status: 'done',
      reviewedBy: 'user-1',
      reviewedAt: '2026-07-01T00:00:05.000Z',
      fieldConfidence: {
        title: 0.95,
        issueSummary: 0.9,
        reproSteps: 0.8,
        severity: 0.8,
        productArea: 0.8,
        hypothesizedRootCause: 0.7,
        nextAction: 0.8,
      },
    })

    renderPage()

    expect(await screen.findByDisplayValue('OTP login loop')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'OTP verification login loop' },
    })
    fireEvent.change(screen.getByLabelText('Feedback note'), {
      target: { value: 'Ready for Linear' },
    })
    fireEvent.change(screen.getByLabelText('Usefulness'), {
      target: { value: 'useful' },
    })
    fireEvent.change(screen.getByLabelText('Edit state'), {
      target: { value: 'accepted' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => {
      expect(updateTicketMock).toHaveBeenCalledWith('ws-1', 'ticket-1', {
        title: 'OTP verification login loop',
        issueSummary: 'Users loop back to login.',
        reproSteps: '1. Verify OTP',
        severity: 'high',
        productArea: 'auth',
        hypothesizedRootCause: 'Cookie missing',
        nextAction: 'Trace cookie write',
        usefulness: 'useful',
        editState: 'accepted',
        feedbackNote: 'Ready for Linear',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy for Linear' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled()
    })
  })

  it('shows failure banner when extraction fails', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: null, status: 'failed', severity: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      nextCursor: null,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'garbled transcript',
      title: null,
      issueSummary: null,
      reproSteps: null,
      severity: null,
      productArea: 'general',
      hypothesizedRootCause: null,
      nextAction: null,
      status: 'failed',
      lastError: 'Transcript did not contain actionable support issue',
      fieldConfidence: {},
    })

    renderPage()

    expect(await screen.findByText('Extraction failed')).toBeDefined()
    expect(screen.getByText('Transcript did not contain actionable support issue')).toBeDefined()
  })

  it('renders selected transcript read-only beside draft fields', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      nextCursor: null,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'Caller says OTP verify bounces back to login after success screen.',
      title: 'OTP login loop',
      issueSummary: 'Users loop back to login.',
      reproSteps: '1. Verify OTP',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'Cookie missing',
      nextAction: 'Trace cookie write',
      status: 'done',
      fieldConfidence: {
        title: 0.9,
        issueSummary: 0.9,
        reproSteps: 0.8,
        severity: 0.8,
        productArea: 0.8,
        hypothesizedRootCause: 0.7,
        nextAction: 0.8,
      },
    })

    renderPage()

    const transcriptField = await screen.findByDisplayValue(
      'Caller says OTP verify bounces back to login after success screen.',
    )
    expect(transcriptField.getAttribute('readonly')).not.toBeNull()
  })

  it('shows confidence summary badge for extracted fields', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      nextCursor: null,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'OTP transcript',
      title: 'OTP login loop',
      issueSummary: 'Users loop back to login.',
      reproSteps: '1. Verify OTP',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'Cookie missing',
      nextAction: 'Trace cookie write',
      status: 'done',
      fieldConfidence: {
        title: 0.9,
        issueSummary: 0.9,
        reproSteps: 0.6,
        severity: 0.8,
        productArea: 0.8,
        hypothesizedRootCause: 0.4,
        nextAction: 0.8,
      },
    })

    renderPage()

    expect(await screen.findByText('5/7 high confidence')).toBeDefined()
  })

  it('shows root-cause verify affordance only when confidence is low', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      nextCursor: null,
    })
    getTicketMock
      .mockResolvedValueOnce({
        id: 'ticket-1',
        transcript: 'OTP transcript',
        title: 'OTP login loop',
        issueSummary: 'Users loop back to login.',
        reproSteps: '1. Verify OTP',
        severity: 'high',
        productArea: 'auth',
        hypothesizedRootCause: 'Cookie missing',
        nextAction: 'Trace cookie write',
        status: 'done',
        fieldConfidence: {
          title: 0.9,
          issueSummary: 0.9,
          reproSteps: 0.8,
          severity: 0.8,
          productArea: 0.8,
          hypothesizedRootCause: 0.4,
          nextAction: 0.8,
        },
      })
      .mockResolvedValueOnce({
        id: 'ticket-1',
        transcript: 'OTP transcript',
        title: 'OTP login loop',
        issueSummary: 'Users loop back to login.',
        reproSteps: '1. Verify OTP',
        severity: 'high',
        productArea: 'auth',
        hypothesizedRootCause: 'Cookie missing',
        nextAction: 'Trace cookie write',
        status: 'done',
        fieldConfidence: {
          title: 0.9,
          issueSummary: 0.9,
          reproSteps: 0.8,
          severity: 0.8,
          productArea: 0.8,
          hypothesizedRootCause: 0.8,
          nextAction: 0.8,
        },
      })

    renderPage()

    expect(await screen.findByText('Best guess - verify')).toBeDefined()

    cleanup()
    renderPage()

    await waitFor(() => {
      expect(screen.queryByText('Best guess - verify')).toBeNull()
    })
  })

  it('renders back to workspace navigation link', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      nextCursor: null,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'OTP transcript',
      title: 'OTP login loop',
      issueSummary: 'Users loop back to login.',
      reproSteps: '1. Verify OTP',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'Cookie missing',
      nextAction: 'Trace cookie write',
      status: 'done',
      fieldConfidence: {},
    })

    renderPage()

    expect((await screen.findByRole('link', { name: 'Back to workspace' })).getAttribute('href')).toBe('/workspaces/ws-1')
  })

  it('logs out and redirects to login', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      nextCursor: null,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'OTP transcript',
      title: 'OTP login loop',
      issueSummary: 'Users loop back to login.',
      reproSteps: '1. Verify OTP',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'Cookie missing',
      nextAction: 'Trace cookie write',
      status: 'done',
      fieldConfidence: {},
    })
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
    })
    await logoutMock.mock.results[0]?.value

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('renders load more tickets and refresh resets to first page', async () => {
    listTicketsMock
      .mockResolvedValueOnce({
        items: [
          { id: 'ticket-1', title: 'Newest ticket', status: 'pending', severity: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
        ],
        nextCursor: 'ticket-cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'ticket-2', title: 'Older ticket', status: 'done', severity: 'low', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:02.000Z' },
        ],
        nextCursor: null,
      })
      .mockResolvedValue({
        items: [
          { id: 'ticket-1', title: 'Newest ticket', status: 'pending', severity: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:04.000Z' },
        ],
        nextCursor: 'ticket-cursor-1',
      })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'Newest transcript',
      title: 'Newest ticket',
      issueSummary: null,
      reproSteps: null,
      severity: null,
      productArea: 'general',
      hypothesizedRootCause: null,
      nextAction: null,
      status: 'pending',
      fieldConfidence: {},
    })

    renderPage()

    expect(await screen.findByText('Newest ticket')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Load more tickets' }))

    await waitFor(() => {
      expect(listTicketsMock).toHaveBeenNthCalledWith(2, 'ws-1', { cursor: 'ticket-cursor-1' })
      expect(screen.getByText('Older ticket')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(listTicketsMock).toHaveBeenNthCalledWith(3, 'ws-1')
    })
  })
})
