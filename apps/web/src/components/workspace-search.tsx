'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, EmptyState, Input, Modal, StatusBanner } from '@repo/ui'
import { FileText, Loader2, MessageSquareText, Search, Ticket } from 'lucide-react'
import { searchWorkspace } from '@/lib/api/search'
import { downloadDocument } from '@/lib/api/documents'

type DocumentResult = {
  documentId: string
  knowledgeBaseId: string
  title: string
  sourceUrl?: string | null
  snippet: string
  score: number
}

type TicketResult = {
  ticketId: string
  title: string
  snippet: string
  score: number
}

type ChatMessageResult = {
  messageId: string
  sessionId: string
  snippet: string
  score: number
}

type SearchResponse = {
  documents: DocumentResult[]
  tickets: TicketResult[]
  chatMessages: ChatMessageResult[]
}

type SearchStatus = 'idle' | 'loading' | 'error' | 'success'

const emptyResults: SearchResponse = { documents: [], tickets: [], chatMessages: [] }

export function WorkspaceSearch({ workspaceId, collapsed }: { workspaceId: string; collapsed: boolean }) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResponse>(emptyResults)
  const [status, setStatus] = React.useState<SearchStatus>('idle')

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  React.useEffect(() => {
    if (!open) return

    const timeout = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [open])

  React.useEffect(() => {
    if (!open) return

    const trimmed = query.trim()
    if (!trimmed) {
      setResults(emptyResults)
      setStatus('idle')
      return
    }

    setStatus('loading')
    const controller = new AbortController()

    const timeout = window.setTimeout(() => {
      void searchWorkspace(workspaceId, trimmed, { signal: controller.signal })
        .then((response) => {
          // A newer keystroke may have superseded this request before it resolved;
          // applying it now would overwrite fresher results with stale ones.
          if (controller.signal.aborted) return
          setResults({
            documents: Array.isArray(response?.documents) ? response.documents : [],
            tickets: Array.isArray(response?.tickets) ? response.tickets : [],
            chatMessages: Array.isArray(response?.chatMessages) ? response.chatMessages : [],
          })
          setStatus('success')
        })
        .catch(() => {
          // An aborted request means a newer keystroke superseded this one — its
          // result is stale, not a failure, so leave status/results untouched.
          if (controller.signal.aborted) return
          setStatus('error')
        })
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [open, query, workspaceId])

  const hasResults =
    results.documents.length > 0 || results.tickets.length > 0 || results.chatMessages.length > 0

  const closeAndNavigate = React.useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  const openDocument = React.useCallback(
    (result: DocumentResult) => {
      setOpen(false)
      if (result.sourceUrl) {
        window.open(result.sourceUrl, '_blank', 'noreferrer')
        return
      }
      void downloadDocument(workspaceId, result.knowledgeBaseId, result.documentId)
    },
    [workspaceId],
  )

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between"
        aria-label="Search workspace"
        onClick={() => setOpen(true)}
      >
        <span className="flex items-center gap-2">
          <Search className="size-4" />
          <span className={collapsed ? 'sr-only' : undefined}>Search workspace</span>
        </span>
        {!collapsed ? <span className="text-xs text-muted-foreground">⌘K</span> : null}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Search workspace" size="full">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="workspace-search-query" className="text-sm font-medium">
              Search query
            </label>
            <div className="relative">
              <Input
                ref={inputRef}
                id="workspace-search-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents, tickets, and chat history"
                className="pr-9"
              />
              {status === 'loading' ? (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : null}
            </div>
          </div>

          {status === 'error' ? (
            <StatusBanner
              variant="error"
              title="Search failed"
              description="We could not complete that search. Try again in a moment."
            />
          ) : null}

          {!query.trim() ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title="Search workspace"
              description="Start typing to search documents, tickets, and chat history."
              className="py-10"
            />
          ) : status === 'error' ? null : status === 'loading' && !hasResults ? (
            <EmptyState
              icon={<Loader2 className="size-5 animate-spin" />}
              title="Searching…"
              description="Looking through documents, tickets, and chat history."
              className="py-10"
            />
          ) : !hasResults ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title="No matches found."
              description="Try a different keyword or a shorter phrase."
              className="py-10"
            />
          ) : (
            <div className="space-y-4">
              {results.documents.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Documents
                  </h3>
                  <div className="space-y-2">
                    {results.documents.map((result) => (
                      <Card key={result.documentId} variant="elevated" className="p-0">
                        <button
                          type="button"
                          aria-label={result.title}
                          className="flex w-full items-start gap-3 p-4 text-left"
                          onClick={() => openDocument(result)}
                        >
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span className="space-y-1">
                            <span className="block font-medium">{result.title}</span>
                            <span className="block text-sm text-muted-foreground">{result.snippet}</span>
                            <span className="block text-xs text-muted-foreground">
                              {result.sourceUrl ? 'Opens in a new tab' : 'Downloads the file'}
                            </span>
                          </span>
                        </button>
                      </Card>
                    ))}
                  </div>
                </section>
              ) : null}

              {results.tickets.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Tickets
                  </h3>
                  <div className="space-y-2">
                    {results.tickets.map((result) => (
                      <Card key={result.ticketId} variant="elevated" className="p-0">
                        <button
                          type="button"
                          aria-label={result.title}
                          className="flex w-full items-start gap-3 p-4 text-left"
                          onClick={() => closeAndNavigate(`/workspaces/${workspaceId}/tickets`)}
                        >
                          <Ticket className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span className="space-y-1">
                            <span className="block font-medium">{result.title}</span>
                            <span className="block text-sm text-muted-foreground">{result.snippet}</span>
                          </span>
                        </button>
                      </Card>
                    ))}
                  </div>
                </section>
              ) : null}

              {results.chatMessages.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Chat Messages
                  </h3>
                  <div className="space-y-2">
                    {results.chatMessages.map((result) => (
                      <Card key={result.messageId} variant="elevated" className="p-0">
                        <button
                          type="button"
                          aria-label="Chat match"
                          className="flex w-full items-start gap-3 p-4 text-left"
                          onClick={() =>
                            closeAndNavigate(`/workspaces/${workspaceId}/chat?session=${result.sessionId}`)
                          }
                        >
                          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span className="space-y-1">
                            <span className="block font-medium">Chat match</span>
                            <span className="block text-sm text-muted-foreground">{result.snippet}</span>
                          </span>
                        </button>
                      </Card>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
