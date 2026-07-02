/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import WorkspaceChatPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const listChatSessionsMock = vi.fn()
const getChatMessagesMock = vi.fn()
const getWorkspaceMock = vi.fn()
const setMessagesMock = vi.fn()
const logoutMock = vi.fn()
let latestUseChatOptions: any = null
let mockMessages = [{ id: 'assistant-1', role: 'assistant', content: 'Grounded answer' }]
let shouldEmitAssistantReply = true

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/chat',
}))

vi.mock('@/lib/api/chat', () => ({
  listChatSessions: (...args: unknown[]) => listChatSessionsMock(...args),
  getChatMessages: (...args: unknown[]) => getChatMessagesMock(...args),
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

vi.mock('ai/react', async () => {
  const ReactModule = await import('react')

  return {
    useChat: (options: any) => {
      latestUseChatOptions = options
      const [messages, setMessagesState] = ReactModule.useState(mockMessages)
      const firedRef = ReactModule.useRef(false)

      ReactModule.useEffect(() => {
        if (firedRef.current) {
          return
        }

        firedRef.current = true
        setMessagesMock.mockImplementation((value: any) => {
          if (typeof value === 'function') {
            setMessagesState((current) => value(current))
          } else {
            setMessagesState(value)
          }
        })

        if (shouldEmitAssistantReply) {
          void options.onResponse?.(
            new Response(null, {
              headers: {
                'X-Chat-Sources': encodeURIComponent(
                  JSON.stringify([
                    {
                      documentId: 'doc-1',
                      title: 'Support SOP',
                      sourceUrl: 'https://example.com/sop',
                      score: 0.88,
                      snippet: 'Grounded excerpt',
                    },
                  ]),
                ),
                'X-Chat-Session-Id': 'session-1',
              },
            }),
          )

          void options.onFinish?.({ id: 'assistant-1', role: 'assistant', content: 'Grounded answer' })
        }
      }, [options])

      return {
        messages,
        setMessages: setMessagesMock,
        input: '',
        setInput: vi.fn(),
        handleInputChange: vi.fn(),
        handleSubmit: vi.fn(),
        isLoading: false,
        error: undefined,
        reload: vi.fn(),
        stop: vi.fn(),
      }
    },
  }
})

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(WorkspaceChatPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('WorkspaceChatPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    listChatSessionsMock.mockReset()
    getChatMessagesMock.mockReset()
    getWorkspaceMock.mockReset()
    setMessagesMock.mockReset()
    logoutMock.mockReset()
    latestUseChatOptions = null
    mockMessages = [{ id: 'assistant-1', role: 'assistant', content: 'Grounded answer' }]
    shouldEmitAssistantReply = true
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme Support' })
    listChatSessionsMock.mockResolvedValue({
      items: [{ id: 'session-1', title: 'Billing help', createdAt: '', updatedAt: '' }],
      nextCursor: null,
    })
    getChatMessagesMock.mockResolvedValue({
      items: [
        { id: 'user-1', role: 'user', content: 'Past question', createdAt: '' },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Grounded answer',
          createdAt: '',
          sources: [
            {
              sourceType: 'document',
              documentId: 'doc-1',
              title: 'Support SOP',
              sourceUrl: 'https://example.com/sop',
              score: 0.88,
              snippet: 'Grounded excerpt',
            },
          ],
        },
      ],
      nextCursor: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('hides history panel by default, showing only chat and sources', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Support SOP')).toBeDefined()
    })

    expect(screen.queryByText('Your sessions in this workspace')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show history' })).toBeDefined()
  })

  it('reveals history panel when the history toggle is clicked', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Show history' }))

    await waitFor(() => {
      expect(screen.getByText('Your sessions in this workspace')).toBeDefined()
      expect(screen.getByText('Billing help')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Hide history' })).toBeDefined()
    })
  })

  it('renders sessions and sources from response header/persisted messages', async () => {
    const { container } = renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Show history' }))
    expect(await screen.findByText('Billing help')).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText('Support SOP')).toBeDefined()
      expect(screen.getByText('Grounded excerpt')).toBeDefined()
    })
    expect(container.querySelector('svg.lucide-search.size-5.text-primary')).not.toBeNull()
    expect(container.querySelector('.rounded-2xl.bg-primary\\/10.text-primary')).toBeNull()
  })

  it('renders ticket citation without link', async () => {
    getChatMessagesMock.mockResolvedValueOnce({
      items: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Grounded answer',
          createdAt: '',
          sources: [
            {
              sourceType: 'ticket',
              ticketId: 'ticket-1',
              title: 'Ticket citation',
              score: 0.77,
              snippet: 'Ticket excerpt',
            },
          ],
        },
      ],
      nextCursor: null,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Ticket citation')).toBeDefined()
      expect(screen.getByText('Ticket excerpt')).toBeDefined()
    })

    expect(screen.queryByRole('link', { name: 'Ticket citation' })).toBeNull()
  })

  it('renders legacy source without sourceType as document citation', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Support SOP' })).toBeDefined()
    })
  })

  it('loads session history and new chat clears session body', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Show history' }))
    expect(await screen.findByText('Billing help')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Billing help' }))

    await waitFor(() => {
      expect(getChatMessagesMock).toHaveBeenCalledWith('ws-1', 'session-1')
    })

    expect(latestUseChatOptions.body).toEqual({ sessionId: 'session-1' })

    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0] as HTMLButtonElement)

    await waitFor(() => {
      expect(setMessagesMock).toHaveBeenCalled()
      expect(latestUseChatOptions.body).toBeUndefined()
    })
  })

  it('renders load more sessions button and appends session page', async () => {
    listChatSessionsMock
      .mockResolvedValueOnce({
        items: [{ id: 'session-1', title: 'Billing help', createdAt: '', updatedAt: '' }],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'session-1', title: 'Billing help', createdAt: '', updatedAt: '' }],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'session-2', title: 'Refund flow', createdAt: '', updatedAt: '' }],
        nextCursor: null,
      })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Show history' }))
    expect(await screen.findByText('Billing help')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }))

    await waitFor(() => {
      expect(listChatSessionsMock).toHaveBeenNthCalledWith(3, 'ws-1', { cursor: 'cursor-1' })
      expect(screen.getByText('Refund flow')).toBeDefined()
    })
  })

  it('renders load more messages button and prepends older message page', async () => {
    getChatMessagesMock
      .mockResolvedValueOnce({
        items: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Grounded answer',
            createdAt: '',
            sources: [
              {
                documentId: 'doc-1',
                title: 'Support SOP',
                sourceUrl: 'https://example.com/sop',
                score: 0.88,
                snippet: 'Grounded excerpt',
              },
            ],
          },
        ],
        nextCursor: 'msg-cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Grounded answer',
            createdAt: '',
            sources: [
              {
                documentId: 'doc-1',
                title: 'Support SOP',
                sourceUrl: 'https://example.com/sop',
                score: 0.88,
                snippet: 'Grounded excerpt',
              },
            ],
          },
        ],
        nextCursor: 'msg-cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'user-older', role: 'user', content: 'Earlier question', createdAt: '' },
        ],
        nextCursor: null,
      })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Show history' }))
    expect(await screen.findByText('Billing help')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Billing help' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load older messages' })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }))

    await waitFor(() => {
      expect(getChatMessagesMock).toHaveBeenNthCalledWith(3, 'ws-1', 'session-1', {
        cursor: 'msg-cursor-1',
      })
      expect(screen.getByText('Earlier question')).toBeDefined()
      expect(screen.getByText('Grounded answer')).toBeDefined()
    })
  })

  it('logs out and redirects to login', async () => {
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('renders app shell title/action and workspace nav active on chat route', async () => {
    renderPage()

    expect(await screen.findByText('Workspace assistant')).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'New chat' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Chat' }).getAttribute('aria-current')).toBe('page')
  })

  it('renders real workspace name in sidebar header', async () => {
    renderPage()

    expect(await screen.findAllByText('Acme Support')).not.toHaveLength(0)
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.queryByText('Workspace')).toBeNull()
  })

  it('redirects to login when workspace fetch is unauthorized', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('hides retry button when there is no assistant answer yet', async () => {
    mockMessages = []
    shouldEmitAssistantReply = false

    renderPage()

    expect(await screen.findByText('No citations yet')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Retry last answer' })).toBeNull()
  })
})
