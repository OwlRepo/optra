'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageSection,
  PageShell,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { Database, Mail, Plus, Trash2 } from 'lucide-react'
import { createKnowledgeBase, deleteKnowledgeBase, listKnowledgeBases } from '@/lib/api/knowledge-bases'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, inviteMember, listWorkspaces } from '@/lib/api/workspaces'

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

const kbSchema = z.object({
  name: z.string().trim().min(1, 'Knowledge base name is required').max(255, 'Knowledge base name is too long'),
})

type Workspace = {
  id: string
  name: string
}

type KnowledgeBase = {
  id: string
  name: string
  workspaceId: string
  createdAt?: string
}

type WorkspaceMembership = {
  id: string
  role: 'owner' | 'admin' | 'member'
}

type InviteFormData = z.infer<typeof inviteSchema>
type KnowledgeBaseFormData = z.infer<typeof kbSchema>

export default function WorkspaceDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const workspaceId = params.id
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [knowledgeBases, setKnowledgeBases] = React.useState<KnowledgeBase[]>([])
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<KnowledgeBase | null>(null)

  const inviteForm = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '' },
  })

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
      setKnowledgeBases(Array.isArray(kbData) ? kbData : [])
      setMembership(
        (Array.isArray(memberships) ? memberships : []).find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null,
      )
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

  const submitInvite = inviteForm.handleSubmit(async (data) => {
    try {
      await inviteMember(workspaceId, data.email)
      toast({
        variant: 'success',
        title: 'Invite sent',
        description: `${data.email} can use the invite link to join.`,
      })
      inviteForm.reset()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      const message =
        err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.'

      toast({
        variant: 'error',
        title: 'Failed to send invite',
        description: message,
      })
    }
  })

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

      const message =
        err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.'

      toast({
        variant: 'error',
        title: 'Failed to create knowledge base',
        description: message,
      })
    }
  })

  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) {
      return
    }

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

      const message =
        err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.'

      toast({
        variant: 'error',
        title: 'Failed to delete knowledge base',
        description: message,
      })
    }
  }, [loadPage, pendingDelete, router, toast, workspaceId])

  return (
    <PageShell contentClassName="pb-16">
      <AppHeader
        title={workspace?.name ?? 'Workspace'}
        description="Invite collaborators and manage the knowledge bases attached to this workspace."
        badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
        navigation={
          <Button asChild variant="ghost" size="sm">
            <Link href="/workspaces">All workspaces</Link>
          </Button>
        }
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="size-4" />
              New knowledge base
            </Button>
          ) : null
        }
      />

      <div className="space-y-8 py-10">
        <PageSection
          eyebrow={<Badge variant="outline">Collaborators</Badge>}
          title="Invite members"
          description="Backend still enforces permissions. This page only shows owner and admin controls when your role is known."
        >
          <Card variant="elevated" className="p-6">
            {canManage ? (
              <form className="grid gap-4 md:grid-cols-[1fr_auto]" onSubmit={submitInvite}>
                <div className="space-y-2">
                  <label htmlFor="member-email" className="text-sm font-medium">
                    Member email
                  </label>
                  <Input id="member-email" type="email" placeholder="teammate@example.com" {...inviteForm.register('email')} />
                  {inviteForm.formState.errors.email ? (
                    <p className="text-sm text-destructive">{inviteForm.formState.errors.email.message}</p>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <Button type="submit" isLoading={inviteForm.formState.isSubmitting} loadingText="Sending">
                    <Mail className="size-4" />
                    Send invite
                  </Button>
                </div>
              </form>
            ) : (
              <EmptyState
                icon={<Mail className="size-5" />}
                title="Invite controls hidden"
                description="Only owners and admins can invite members to this workspace."
              />
            )}
          </Card>
        </PageSection>

        <PageSection
          eyebrow={<Badge variant="secondary">Knowledge</Badge>}
          title="Knowledge bases"
          description="Each knowledge base holds the documents used for retrieval."
        >
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
              actions={
                canManage ? (
                  <Button onClick={() => setIsCreateModalOpen(true)}>
                    <Plus className="size-4" />
                    New knowledge base
                  </Button>
                ) : undefined
              }
            />
          ) : (
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
                    <TableCell>
                      {knowledgeBase.createdAt ? new Date(knowledgeBase.createdAt).toLocaleDateString() : 'Recently created'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/workspaces/${workspaceId}/knowledge-bases/${knowledgeBase.id}`}>Open</Link>
                        </Button>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${knowledgeBase.name}`}
                            onClick={() => setPendingDelete(knowledgeBase)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageSection>
      </div>

      <Modal
        open={isCreateModalOpen}
        onClose={() => {
          if (!knowledgeBaseForm.formState.isSubmitting) {
            setIsCreateModalOpen(false)
            knowledgeBaseForm.reset()
          }
        }}
        title="Create knowledge base"
      >
        <form className="space-y-4" onSubmit={submitKnowledgeBase}>
          <div className="space-y-2">
            <label htmlFor="knowledge-base-name" className="text-sm font-medium">
              Knowledge base name
            </label>
            <Input id="knowledge-base-name" {...knowledgeBaseForm.register('name')} />
            {knowledgeBaseForm.formState.errors.name ? (
              <p className="text-sm text-destructive">{knowledgeBaseForm.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={knowledgeBaseForm.formState.isSubmitting} loadingText="Creating">
              Create knowledge base
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete knowledge base"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {pendingDelete ? `Delete ${pendingDelete.name}? This fails if documents still exist inside it.` : ''}
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
              Delete knowledge base
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  )
}
