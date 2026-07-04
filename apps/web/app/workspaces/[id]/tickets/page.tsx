'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageSection,
  Pagination,
  Select,
  Skeleton,
  StatusBanner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast,
} from '@repo/ui'
import { ClipboardCopy, FileUp, RefreshCcw, Save, Search, Sparkles } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { createTicket, getTicket, listTickets, updateTicket } from '@/lib/api/tickets'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace } from '@/lib/api/workspaces'
import { WorkspaceNav } from '@/components/workspace-nav'

type TicketStatus = 'pending' | 'processing' | 'done' | 'failed'
type Severity = 'low' | 'medium' | 'high' | null

type TicketSummary = {
  id: string
  title: string | null
  status: TicketStatus
  severity: Severity
  indexed: boolean
  createdAt?: string
  updatedAt?: string
}

type TicketListResponse = {
  items: TicketSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type TicketDetail = {
  id: string
  transcript: string
  title: string | null
  issueSummary: string | null
  reproSteps: string | null
  severity: Severity
  productArea: string | null
  hypothesizedRootCause: string | null
  nextAction: string | null
  usefulness?: 'useful' | 'not_useful' | null
  editState?: 'accepted' | 'heavily_edited' | null
  feedbackNote?: string | null
  fieldConfidence: Record<string, number>
  status: TicketStatus
  lastError?: string | null
}

type EditorState = {
  title: string
  issueSummary: string
  reproSteps: string
  severity: '' | 'low' | 'medium' | 'high'
  productArea: string
  hypothesizedRootCause: string
  nextAction: string
  usefulness: '' | 'useful' | 'not_useful'
  editState: '' | 'accepted' | 'heavily_edited'
  feedbackNote: string
}

type StatusFilter = '' | TicketStatus
type SeverityFilter = '' | 'low' | 'medium' | 'high'
type UsefulnessFilter = '' | 'useful' | 'not_useful'
type IndexedFilter = '' | 'true' | 'false'

const statusVariant: Record<TicketStatus, 'secondary' | 'success' | 'destructive'> = {
  pending: 'secondary',
  processing: 'secondary',
  done: 'success',
  failed: 'destructive',
}

const confidenceFields = [
  'title',
  'issueSummary',
  'reproSteps',
  'severity',
  'productArea',
  'hypothesizedRootCause',
  'nextAction',
] as const

function toEditorState(ticket: TicketDetail): EditorState {
  return {
    title: ticket.title ?? '',
    issueSummary: ticket.issueSummary ?? '',
    reproSteps: ticket.reproSteps ?? '',
    severity: ticket.severity ?? '',
    productArea: ticket.productArea ?? 'general',
    hypothesizedRootCause: ticket.hypothesizedRootCause ?? '',
    nextAction: ticket.nextAction ?? '',
    usefulness: ticket.usefulness ?? '',
    editState: ticket.editState ?? '',
    feedbackNote: ticket.feedbackNote ?? '',
  }
}

function formatLinearMarkdown(ticket: EditorState) {
  return [
    `# ${ticket.title || 'Untitled ticket'}`,
    '',
    `Severity: ${ticket.severity || 'unspecified'}`,
    `Product area: ${ticket.productArea || 'general'}`,
    '',
    '## Issue summary',
    ticket.issueSummary || 'n/a',
    '',
    '## Repro steps',
    ticket.reproSteps || 'n/a',
    '',
    '## Hypothesized root cause',
    ticket.hypothesizedRootCause || 'n/a',
    '',
    '## Next action',
    ticket.nextAction || 'n/a',
    '',
    '## Review feedback',
    `Usefulness: ${ticket.usefulness || 'unset'}`,
    `Edit state: ${ticket.editState || 'unset'}`,
    ticket.feedbackNote || 'n/a',
  ].join('\n')
}

function countHighConfidenceFields(fieldConfidence: TicketDetail['fieldConfidence']) {
  return confidenceFields.filter((field) => (fieldConfidence[field] ?? 0) >= 0.7).length
}

export default function TicketsPage({ params }: { params: { id: string } }) {
  const workspaceId = params.id
  const router = useRouter()
  const { toast } = useToast()
  const [workspace, setWorkspace] = React.useState<{ id: string; name: string } | null>(null)
  const [tickets, setTickets] = React.useState<TicketSummary[]>([])
  const [meta, setMeta] = React.useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [ticketSearch, setTicketSearch] = React.useState('')
  const [debouncedTicketSearch, setDebouncedTicketSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('')
  const [severityFilter, setSeverityFilter] = React.useState<SeverityFilter>('')
  const [usefulnessFilter, setUsefulnessFilter] = React.useState<UsefulnessFilter>('')
  const [indexedFilter, setIndexedFilter] = React.useState<IndexedFilter>('')
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null)
  const [selectedTicket, setSelectedTicket] = React.useState<TicketDetail | null>(null)
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [reviewModalOpen, setReviewModalOpen] = React.useState(false)
  const [transcript, setTranscript] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [isTicketsLoading, setIsTicketsLoading] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)

  const handleUnauthorized = React.useCallback((error: unknown) => {
    if (isUnauthorized(error)) {
      router.push('/login')
      return true
    }
    return false
  }, [router])

  // Debounce the search box so we don't fire a request on every keystroke.
  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedTicketSearch(ticketSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [ticketSearch])

  // Changing a filter or page size always returns to the first page.
  React.useEffect(() => {
    setPage(1)
  }, [debouncedTicketSearch, statusFilter, severityFilter, usefulnessFilter, indexedFilter, pageSize])

  const loadTickets = React.useCallback(async () => {
    try {
      setIsTicketsLoading(true)
      const data = (await listTickets(workspaceId, {
        page,
        pageSize,
        q: debouncedTicketSearch || undefined,
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
        usefulness: usefulnessFilter || undefined,
        indexed: indexedFilter || undefined,
      })) as TicketListResponse
      setTickets(Array.isArray(data?.items) ? data.items : [])
      setMeta({
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? pageSize,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
      })
    } catch (error) {
      if (handleUnauthorized(error)) return
      toast({
        variant: 'error',
        title: 'Failed to load tickets',
        description: error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Try again in a moment.',
      })
    } finally {
      setIsLoading(false)
      setIsTicketsLoading(false)
    }
  }, [
    debouncedTicketSearch,
    handleUnauthorized,
    indexedFilter,
    page,
    pageSize,
    severityFilter,
    statusFilter,
    toast,
    usefulnessFilter,
    workspaceId,
  ])

  const loadTicketDetail = React.useCallback(async (ticketId: string) => {
    try {
      const data = await getTicket(workspaceId, ticketId)
      setSelectedTicket(data)
      setEditor(toEditorState(data))
    } catch (error) {
      if (handleUnauthorized(error)) return
      toast({
        variant: 'error',
        title: 'Failed to load ticket detail',
        description: error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Try again in a moment.',
      })
    }
  }, [handleUnauthorized, toast, workspaceId])

  React.useEffect(() => {
    void getWorkspace(workspaceId)
      .then((data) => {
        setWorkspace(data)
      })
      .catch((error) => {
        if (handleUnauthorized(error)) return
      })
  }, [handleUnauthorized, workspaceId])

  React.useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  React.useEffect(() => {
    if (tickets.length === 0) {
      setSelectedTicketId(null)
      setSelectedTicket(null)
      setEditor(null)
      return
    }

    if (!selectedTicketId || !tickets.some((ticket) => ticket.id === selectedTicketId)) {
      setSelectedTicketId(tickets[0]?.id ?? null)
    }
  }, [selectedTicketId, tickets])

  React.useEffect(() => {
    if (!selectedTicketId) return
    void loadTicketDetail(selectedTicketId)
  }, [loadTicketDetail, selectedTicketId])

  const hasInFlightTickets = tickets.some((ticket) => ticket.status === 'pending' || ticket.status === 'processing')

  React.useEffect(() => {
    if (!hasInFlightTickets) return
    const intervalId = window.setInterval(() => {
      void loadTickets()
      if (selectedTicketId) {
        void loadTicketDetail(selectedTicketId)
      }
    }, 3000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [hasInFlightTickets, loadTicketDetail, loadTickets, selectedTicketId])

  const openReview = React.useCallback((ticketId: string) => {
    setSelectedTicketId(ticketId)
    setReviewModalOpen(true)
  }, [])

  const handleCreate = React.useCallback(async () => {
    if (!transcript.trim()) {
      return
    }

    setIsCreating(true)
    try {
      const created = await createTicket(workspaceId, { transcript: transcript.trim() })
      setTranscript('')
      await loadTickets()
      await loadTicketDetail(created.id)
      openReview(created.id)
      toast({
        variant: 'success',
        title: created.status === 'pending' ? 'Extraction queued' : 'Existing ticket reused',
        description: created.status === 'pending'
          ? 'Ticket draft is processing now.'
          : 'Same transcript already has a draft in this workspace.',
      })
    } catch (error) {
      if (handleUnauthorized(error)) return
      toast({
        variant: 'error',
        title: 'Failed to extract ticket',
        description: error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Try again in a moment.',
      })
    } finally {
      setIsCreating(false)
    }
  }, [handleUnauthorized, loadTicketDetail, loadTickets, openReview, toast, transcript, workspaceId])

  const handleSave = React.useCallback(async () => {
    if (!selectedTicketId || !editor) return

    setIsSaving(true)
    try {
      const updated = await updateTicket(workspaceId, selectedTicketId, {
        title: editor.title,
        issueSummary: editor.issueSummary,
        reproSteps: editor.reproSteps,
        severity: editor.severity || undefined,
        productArea: editor.productArea,
        hypothesizedRootCause: editor.hypothesizedRootCause,
        nextAction: editor.nextAction,
        usefulness: editor.usefulness || undefined,
        editState: editor.editState || undefined,
        feedbackNote: editor.feedbackNote,
      })
      setSelectedTicket(updated)
      setEditor(toEditorState(updated))
      await loadTickets()
      toast({
        variant: 'success',
        title: 'Review saved',
        description: 'Ticket draft and feedback updated.',
      })
    } catch (error) {
      if (handleUnauthorized(error)) return
      toast({
        variant: 'error',
        title: 'Failed to save review',
        description: error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Try again in a moment.',
      })
    } finally {
      setIsSaving(false)
    }
  }, [editor, handleUnauthorized, loadTickets, selectedTicketId, toast, workspaceId])

  const handleCopy = React.useCallback(async () => {
    if (!editor) return

    try {
      await navigator.clipboard.writeText(formatLinearMarkdown(editor))
      toast({
        variant: 'success',
        title: 'Copied for Linear',
        description: 'Ticket markdown copied to clipboard.',
      })
    } catch {
      toast({
        variant: 'error',
        title: 'Copy failed',
        description: 'Clipboard access was blocked.',
      })
    }
  }, [editor, toast])

  const highConfidenceCount = selectedTicket ? countHighConfidenceFields(selectedTicket.fieldConfidence ?? {}) : 0
  const lowConfidenceRootCause = (selectedTicket?.fieldConfidence?.hypothesizedRootCause ?? 0) < 0.7

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <Link href="/workspaces" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            {workspace?.name?.[0]?.toUpperCase() ?? 'W'}
          </span>
          {!collapsed ? <span className="truncate">{workspace?.name ?? 'Workspace'}</span> : null}
        </Link>
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
        title="Ticket copilot"
        description="Paste support-call transcripts, review extracted drafts, then copy polished tickets into Linear."
        badge={<Badge variant="secondary">Workspace scoped</Badge>}
      actions={<Button variant="outline" size="sm" onClick={() => void loadTickets()}><RefreshCcw className="size-4" />Refresh</Button>}
      onLogout={handleLogout}
    >
      <div className="space-y-8 px-6 py-10">
        <PageSection
          eyebrow={<Badge variant="outline">Transcript intake</Badge>}
          title={<h1 className="text-3xl font-semibold md:text-4xl">Draft tickets from support calls</h1>}
          description="Queue extraction, watch status, then tighten fields and record review quality before handoff."
        >
          <div className="grid gap-6">
            <Card variant="elevated" className="p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="ticket-transcript">Transcript</label>
                  <Textarea
                    id="ticket-transcript"
                    aria-label="Transcript"
                    rows={12}
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    placeholder="Paste support call transcript"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={handleCreate} isLoading={isCreating} loadingText="Extracting">
                    {!isCreating ? <Sparkles className="size-4" /> : null}
                    {!isCreating ? 'Extract ticket' : null}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push(`/workspaces/${workspaceId}/knowledge-bases`)}
                  >
                    <FileUp className="size-4" />
                    Upload files
                  </Button>
                </div>
              </div>
            </Card>

            <Card variant="elevated" className="p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-primary">Ticket queue</p>
                  <h2 className="mt-1 text-2xl font-semibold">Workspace drafts</h2>
                </div>
                <Badge variant="outline">{meta.total} total</Badge>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search workspace drafts"
                    placeholder="Search by title"
                    className="pl-9"
                    value={ticketSearch}
                    onChange={(event) => setTicketSearch(event.target.value)}
                  />
                </div>
                <Select
                  aria-label="Filter by status"
                  className="sm:w-40"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                >
                  <option value="">All statuses</option>
                  <option value="pending">pending</option>
                  <option value="processing">processing</option>
                  <option value="done">done</option>
                  <option value="failed">failed</option>
                </Select>
                <Select
                  aria-label="Filter by severity"
                  className="sm:w-36"
                  value={severityFilter}
                  onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                >
                  <option value="">All severities</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </Select>
                <Select
                  aria-label="Filter by usefulness"
                  className="sm:w-40"
                  value={usefulnessFilter}
                  onChange={(event) => setUsefulnessFilter(event.target.value as UsefulnessFilter)}
                >
                  <option value="">All feedback</option>
                  <option value="useful">useful</option>
                  <option value="not_useful">not_useful</option>
                </Select>
                <Select
                  aria-label="Filter by reference usage"
                  className="sm:w-44"
                  value={indexedFilter}
                  onChange={(event) => setIndexedFilter(event.target.value as IndexedFilter)}
                >
                  <option value="">All drafts</option>
                  <option value="true">Usable as reference</option>
                  <option value="false">Not usable yet</option>
                </Select>
              </div>

              <div className="mt-6">
                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : tickets.length === 0 ? (
                  <EmptyState
                    title="No ticket drafts yet"
                    description="Paste first transcript to start extraction."
                  />
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Reference</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tickets.map((ticket) => (
                          <TableRow
                            key={ticket.id}
                            onClick={() => openReview(ticket.id)}
                            className="cursor-pointer"
                          >
                            <TableCell>{ticket.title ?? 'Untitled draft'}</TableCell>
                            <TableCell><Badge variant={statusVariant[ticket.status]}>{ticket.status}</Badge></TableCell>
                            <TableCell>{ticket.severity ?? '—'}</TableCell>
                            <TableCell>
                              <Badge variant={ticket.indexed ? 'success' : 'secondary'}>
                                {ticket.indexed ? 'Indexed' : 'Not indexed'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <Pagination
                      className="mt-4"
                      page={meta.page}
                      pageSize={meta.pageSize}
                      total={meta.total}
                      totalPages={meta.totalPages}
                      onPageChange={setPage}
                      onPageSizeChange={setPageSize}
                      isLoading={isTicketsLoading}
                    />
                  </>
                )}
              </div>
            </Card>
          </div>
        </PageSection>
      </div>

      <Modal
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        title="Refine extracted draft"
        size="xl"
      >
        {!selectedTicket || !editor ? (
          <EmptyState
            title="Select a draft"
            description="Choose a ticket from queue to review extracted fields."
          />
        ) : (
          <div className="space-y-6">
            {selectedTicket.status === 'failed' ? (
              <StatusBanner
                variant="error"
                title="Extraction failed"
                description={selectedTicket.lastError ?? 'Ticket extraction failed.'}
              />
            ) : null}

            {selectedTicket.status === 'pending' || selectedTicket.status === 'processing' ? (
              <StatusBanner
                variant="loading"
                title="Extraction in progress"
                description="Polling every 3 seconds until draft is ready."
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">{highConfidenceCount}/7 high confidence</Badge>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <Card variant="subtle" className="border-border/70 bg-background/70 p-5">
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-primary">Source transcript</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Review extracted fields against original caller wording.
                    </p>
                  </div>
                  <Textarea
                    aria-label="Source transcript"
                    value={selectedTicket.transcript}
                    rows={18}
                    readOnly
                    className="min-h-[22rem]"
                  />
                </div>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="ticket-title">Title</label>
                  <Input
                    id="ticket-title"
                    aria-label="Title"
                    value={editor.title}
                    onChange={(event) => setEditor((current) => current ? { ...current, title: event.target.value } : current)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="ticket-severity">Severity</label>
                  <Select
                    id="ticket-severity"
                    aria-label="Severity"
                    value={editor.severity}
                    onChange={(event) => setEditor((current) => current ? { ...current, severity: event.target.value as EditorState['severity'] } : current)}
                  >
                    <option value="">Unset</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="ticket-product-area">Product area</label>
                  <Input
                    id="ticket-product-area"
                    aria-label="Product area"
                    value={editor.productArea}
                    onChange={(event) => setEditor((current) => current ? { ...current, productArea: event.target.value } : current)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="ticket-issue-summary">Issue summary</label>
                  <Textarea
                    id="ticket-issue-summary"
                    aria-label="Issue summary"
                    rows={4}
                    value={editor.issueSummary}
                    onChange={(event) => setEditor((current) => current ? { ...current, issueSummary: event.target.value } : current)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="ticket-repro-steps">Repro steps</label>
                  <Textarea
                    id="ticket-repro-steps"
                    aria-label="Repro steps"
                    rows={5}
                    value={editor.reproSteps}
                    onChange={(event) => setEditor((current) => current ? { ...current, reproSteps: event.target.value } : current)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm font-medium" htmlFor="ticket-root-cause">Hypothesized root cause</label>
                    {lowConfidenceRootCause ? (
                      <Badge variant="warning">Best guess - verify</Badge>
                    ) : null}
                  </div>
                  <Textarea
                    id="ticket-root-cause"
                    aria-label="Hypothesized root cause"
                    rows={4}
                    value={editor.hypothesizedRootCause}
                    onChange={(event) => setEditor((current) => current ? { ...current, hypothesizedRootCause: event.target.value } : current)}
                    className={lowConfidenceRootCause ? 'border-amber-500/40 bg-amber-500/5' : undefined}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="ticket-next-action">Next action</label>
                  <Textarea
                    id="ticket-next-action"
                    aria-label="Next action"
                    rows={4}
                    value={editor.nextAction}
                    onChange={(event) => setEditor((current) => current ? { ...current, nextAction: event.target.value } : current)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="ticket-usefulness">Usefulness</label>
                  <Select
                    id="ticket-usefulness"
                    aria-label="Usefulness"
                    value={editor.usefulness}
                    onChange={(event) => setEditor((current) => current ? { ...current, usefulness: event.target.value as EditorState['usefulness'] } : current)}
                  >
                    <option value="">Unset</option>
                    <option value="useful">useful</option>
                    <option value="not_useful">not_useful</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="ticket-edit-state">Edit state</label>
                  <Select
                    id="ticket-edit-state"
                    aria-label="Edit state"
                    value={editor.editState}
                    onChange={(event) => setEditor((current) => current ? { ...current, editState: event.target.value as EditorState['editState'] } : current)}
                  >
                    <option value="">Unset</option>
                    <option value="accepted">accepted</option>
                    <option value="heavily_edited">heavily_edited</option>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="ticket-feedback-note">Feedback note</label>
                  <Textarea
                    id="ticket-feedback-note"
                    aria-label="Feedback note"
                    rows={3}
                    value={editor.feedbackNote}
                    onChange={(event) => setEditor((current) => current ? { ...current, feedbackNote: event.target.value } : current)}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleSave} isLoading={isSaving} loadingText="Saving">
                {!isSaving ? <Save className="size-4" /> : null}
                {!isSaving ? 'Save review' : null}
              </Button>
              <Button variant="outline" onClick={handleCopy}>
                <ClipboardCopy className="size-4" />
                Copy for Linear
              </Button>
              <p className="text-xs text-muted-foreground">
                Copies formatted markdown — paste directly into a new Linear issue description.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
