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
const getWorkspaceMock = vi.fn()
const updateTicketMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/tickets',
}))

vi.mock('@/lib/api/tickets', () => ({
  listTickets: (...args: unknown[]) => listTicketsMock(...args),
  createTicket: (...args: unknown[]) => createTicketMock(...args),
  getTicket: (...args: unknown[]) => getTicketMock(...args),
  updateTicket: (...args: unknown[]) => updateTicketMock(...args),
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
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
    getWorkspaceMock.mockReset()
    updateTicketMock.mockReset()
    logoutMock.mockReset()
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme Support' })
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
    vi.restoreAllMocks()
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
      .mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
      .mockResolvedValueOnce({
        items: [{ id: 'ticket-1', title: null, status: 'pending', severity: null, indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      })
      .mockResolvedValue({
        items: [{ id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
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
      expect(screen.getByText('pending', { selector: 'div' })).toBeDefined()
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
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    fireEvent.click(await screen.findByText('OTP login loop'))

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
        { id: 'ticket-1', title: null, status: 'failed', severity: null, indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    fireEvent.click(await screen.findByText('Untitled draft'))

    expect(await screen.findByText('Extraction failed')).toBeDefined()
    expect(screen.getByText('Transcript did not contain actionable support issue')).toBeDefined()
  })

  it('renders selected transcript read-only beside draft fields', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    fireEvent.click(await screen.findByText('OTP login loop'))

    const transcriptField = await screen.findByDisplayValue(
      'Caller says OTP verify bounces back to login after success screen.',
    )
    expect(transcriptField.getAttribute('readonly')).not.toBeNull()
  })

  it('shows confidence summary badge for extracted fields', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    fireEvent.click(await screen.findByText('OTP login loop'))

    expect(await screen.findByText('5/7 high confidence')).toBeDefined()
  })

  it('shows root-cause verify affordance only when confidence is low', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    fireEvent.click(await screen.findByText('OTP login loop'))

    expect(await screen.findByText('Best guess - verify')).toBeDefined()

    cleanup()
    renderPage()

    fireEvent.click(await screen.findByText('OTP login loop'))

    await waitFor(() => {
      expect(screen.queryByText('Best guess - verify')).toBeNull()
    })
  })

  it('renders workspace nav active on tickets route', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    expect(await screen.findByText('Ticket copilot')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Tickets' }).getAttribute('aria-current')).toBe('page')
  })

  it('logs out and redirects to login', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

  it('paginates workspace drafts to the next page via the pagination control', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'Newest ticket', status: 'pending', severity: null, indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 40,
      totalPages: 2,
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
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => {
      expect(listTicketsMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ page: 2 }))
    })
  })

  it('searches workspace drafts by title through the backend', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'Newest ticket', status: 'pending', severity: null, indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    await screen.findByText('Newest ticket')
    fireEvent.change(screen.getByLabelText('Search workspace drafts'), { target: { value: 'billing' } })

    await waitFor(() => {
      expect(listTicketsMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ q: 'billing' }))
    })
  })

  it('filters workspace drafts by status and by indexed through the backend', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'Newest ticket', status: 'pending', severity: null, indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
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

    await screen.findByText('Newest ticket')

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'failed' } })
    await waitFor(() => {
      expect(listTicketsMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ status: 'failed' }))
    })

    fireEvent.change(screen.getByLabelText('Filter by reference usage'), { target: { value: 'true' } })
    await waitFor(() => {
      expect(listTicketsMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ indexed: 'true' }))
    })
  })

  it('shows an indexed badge only for tickets usable as chat reference', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'Indexed ticket', status: 'done', severity: 'high', indexed: true, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
        { id: 'ticket-2', title: 'Not indexed ticket', status: 'done', severity: 'low', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:02.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'Indexed transcript',
      title: 'Indexed ticket',
      issueSummary: null,
      reproSteps: null,
      severity: 'high',
      productArea: 'general',
      hypothesizedRootCause: null,
      nextAction: null,
      status: 'done',
      fieldConfidence: {},
    })

    renderPage()

    await screen.findByText('Indexed ticket')
    expect(screen.getByText('Indexed')).toBeDefined()
    expect(screen.getByText('Not indexed')).toBeDefined()
  })

  it('navigates to knowledge bases when Upload files is clicked', async () => {
    listTicketsMock.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })

    renderPage()

    await screen.findByText('No ticket drafts yet')
    fireEvent.click(screen.getByRole('button', { name: 'Upload files' }))

    expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/knowledge-bases')
  })

  it('shows a helper caption explaining what Copy for Linear does', async () => {
    listTicketsMock.mockResolvedValue({
      items: [
        { id: 'ticket-1', title: 'OTP login loop', status: 'done', severity: 'high', indexed: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:03.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    })
    getTicketMock.mockResolvedValue({
      id: 'ticket-1',
      transcript: 'OTP transcript',
      title: 'OTP login loop',
      issueSummary: null,
      reproSteps: null,
      severity: 'high',
      productArea: 'general',
      hypothesizedRootCause: null,
      nextAction: null,
      status: 'done',
      fieldConfidence: {},
    })

    renderPage()

    fireEvent.click(await screen.findByText('OTP login loop'))

    expect(await screen.findByText(/paste directly into a new Linear issue/i)).toBeDefined()
  })

  it('renders real workspace name in sidebar header', async () => {
    listTicketsMock.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })

    renderPage()

    expect(await screen.findAllByText('Acme Support')).not.toHaveLength(0)
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.queryByText('Workspace')).toBeNull()
  })

  it('redirects to login when workspace fetch is unauthorized', async () => {
    listTicketsMock.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
