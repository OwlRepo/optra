'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { Database, Plus, Trash2 } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { createKnowledgeBase, deleteKnowledgeBase, listKnowledgeBases } from '@/lib/api/knowledge-bases'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

const kbSchema = z.object({
  name: z.string().trim().min(1, 'Knowledge base name is required').max(255, 'Knowledge base name is too long'),
})

type Workspace = { id: string; name: string }
type KnowledgeBase = { id: string; name: string; workspaceId: string; createdAt?: string }
type KnowledgeBaseListResponse = { items: KnowledgeBase[]; nextCursor: string | null }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type KnowledgeBaseFormData = z.infer<typeof kbSchema>

export default function KnowledgeBasesPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const workspaceId = params.id
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [knowledgeBases, setKnowledgeBases] = React.useState<KnowledgeBase[]>([])
  const [knowledgeBaseNextCursor, setKnowledgeBaseNextCursor] = React.useState<string | null>(null)
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<KnowledgeBase | null>(null)
  const [isLoadingMoreKnowledgeBases, setIsLoadingMoreKnowledgeBases] = React.useState(false)

  const knowledgeBaseForm = useForm<KnowledgeBaseFormData>({
    resolver: zodResolver(kbSchema),
    defaultValues: { name: '' },
  })

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [workspaceData, kbData, memberships] = await Promise.all([
        getWorkspace(workspaceId),
        listKnowledgeBases(workspaceId),
        listWorkspaces(),
      ])
      setWorkspace(workspaceData)
      setKnowledgeBases(Array.isArray(kbData?.items) ? kbData.items : [])
      setKnowledgeBaseNextCursor(kbData?.nextCursor ?? null)
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to load workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsLoading(false)
    }
  }, [router, workspaceId])

  React.useEffect(() => {
    void loadPage()
  }, [loadPage])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  const loadMoreKnowledgeBases = React.useCallback(async () => {
    if (!knowledgeBaseNextCursor) return
    try {
      setIsLoadingMoreKnowledgeBases(true)
      const data = (await listKnowledgeBases(workspaceId, { cursor: knowledgeBaseNextCursor })) as KnowledgeBaseListResponse
      setKnowledgeBases((current) => [...current, ...(Array.isArray(data?.items) ? data.items : [])])
      setKnowledgeBaseNextCursor(data?.nextCursor ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to load more knowledge bases',
        description: err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.',
      })
    } finally {
      setIsLoadingMoreKnowledgeBases(false)
    }
  }, [knowledgeBaseNextCursor, router, toast, workspaceId])

  const submitKnowledgeBase = knowledgeBaseForm.handleSubmit(async (data) => {
    try {
      await createKnowledgeBase(workspaceId, data.name)
      toast({
        variant: 'success',
        title: 'Knowledge base created',
        description: `${data.name} is ready for documents.`,
      })
      knowledgeBaseForm.reset()
      setIsCreateModalOpen(false)
      await loadPage()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to create knowledge base',
        description: err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.',
      })
    }
  })

  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) return
    try {
      await deleteKnowledgeBase(workspaceId, pendingDelete.id)
      toast({
        variant: 'success',
        title: 'Knowledge base deleted',
        description: `${pendingDelete.name} was removed.`,
      })
      setPendingDelete(null)
      await loadPage()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to delete knowledge base',
        description: err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.',
      })
    }
  }, [loadPage, pendingDelete, router, toast, workspaceId])

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      title="Knowledge bases"
      description="Each knowledge base holds the documents used for retrieval."
      badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
      actions={canManage ? <Button size="sm" onClick={() => setIsCreateModalOpen(true)}><Plus className="size-4" />New knowledge base</Button> : null}
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
        {isLoading ? (
          <Card variant="elevated" className="space-y-4 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        ) : knowledgeBases.length === 0 ? (
          <EmptyState
            icon={<Database className="size-5" />}
            title="No knowledge bases yet"
            description="Create a knowledge base, then upload documents into it."
            actions={canManage ? <Button onClick={() => setIsCreateModalOpen(true)}><Plus className="size-4" />New knowledge base</Button> : undefined}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {knowledgeBases.map((knowledgeBase) => (
                  <TableRow key={knowledgeBase.id}>
                    <TableCell className="font-medium">{knowledgeBase.name}</TableCell>
                    <TableCell>{knowledgeBase.createdAt ? new Date(knowledgeBase.createdAt).toLocaleDateString() : 'Recently created'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/workspaces/${workspaceId}/knowledge-bases/${knowledgeBase.id}`}>Open</Link>
                        </Button>
                        {canManage ? <Button variant="ghost" size="sm" aria-label={`Delete ${knowledgeBase.name}`} onClick={() => setPendingDelete(knowledgeBase)}><Trash2 className="size-4" />Delete</Button> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {knowledgeBaseNextCursor ? (
              <div className="mt-4 flex justify-center">
                <Button type="button" variant="outline" onClick={() => void loadMoreKnowledgeBases()} isLoading={isLoadingMoreKnowledgeBases} loadingText="Loading" aria-label="Load more knowledge bases">
                  {!isLoadingMoreKnowledgeBases ? 'Load more knowledge bases' : null}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <Modal open={isCreateModalOpen} onClose={() => {
        if (!knowledgeBaseForm.formState.isSubmitting) {
          setIsCreateModalOpen(false)
          knowledgeBaseForm.reset()
        }
      }} title="Create knowledge base">
        <form className="space-y-4" onSubmit={submitKnowledgeBase}>
          <div className="space-y-2">
            <label htmlFor="knowledge-base-name" className="text-sm font-medium">Knowledge base name</label>
            <Input id="knowledge-base-name" {...knowledgeBaseForm.register('name')} />
            {knowledgeBaseForm.formState.errors.name ? <p className="text-sm text-destructive">{knowledgeBaseForm.formState.errors.name.message}</p> : null}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
            <Button type="submit" isLoading={knowledgeBaseForm.formState.isSubmitting} loadingText="Creating">Create knowledge base</Button>
          </div>
        </form>
      </Modal>

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete knowledge base">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{pendingDelete ? `Delete ${pendingDelete.name}? This fails if documents still exist inside it.` : ''}</p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>Delete knowledge base</Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
