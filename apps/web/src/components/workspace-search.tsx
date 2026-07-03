'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, EmptyState, Input, Modal } from '@repo/ui'
import { FileText, MessageSquareText, Search, Ticket } from 'lucide-react'
import { searchWorkspace } from '@/lib/api/search'

type DocumentResult = {
  documentId: string
  knowledgeBaseId: string
  title: string
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

const emptyResults: SearchResponse = { documents: [], tickets: [], chatMessages: [] }

export function WorkspaceSearch({ workspaceId, collapsed }: { workspaceId: string; collapsed: boolean }) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResponse>(emptyResults)

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
      return
    }

    const timeout = window.setTimeout(() => {
      void searchWorkspace(workspaceId, trimmed).then((response) => {
        setResults({
          documents: Array.isArray(response?.documents) ? response.documents : [],
          tickets: Array.isArray(response?.tickets) ? response.tickets : [],
          chatMessages: Array.isArray(response?.chatMessages) ? response.chatMessages : [],
        })
      })
    }, 300)

    return () => window.clearTimeout(timeout)
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

      <Modal open={open} onClose={() => setOpen(false)} title="Search workspace">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="workspace-search-query" className="text-sm font-medium">
              Search query
            </label>
            <Input
              ref={inputRef}
              id="workspace-search-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents, tickets, and chat history"
            />
          </div>

          {!query.trim() ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title="Search workspace"
              description="Start typing to search documents, tickets, and chat history."
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
                          onClick={() =>
                            closeAndNavigate(`/workspaces/${workspaceId}/knowledge-bases/${result.knowledgeBaseId}`)
                          }
                        >
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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
                          onClick={() => closeAndNavigate(`/workspaces/${workspaceId}/chat`)}
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
