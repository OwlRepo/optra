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
import { BriefcaseBusiness, Plus } from 'lucide-react'
import { createWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'

const schema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(255, 'Workspace name is too long'),
})

type Workspace = {
  id: string
  name: string
  role: string
  ownerId?: string
  createdAt?: string
}

type FormData = z.infer<typeof schema>

export default function WorkspacesPage() {
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  })

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const loadWorkspaces = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await listWorkspaces()
      setWorkspaces(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      toastRef.current({
        variant: 'error',
        title: 'Failed to load workspaces',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsLoading(false)
    }
  }, [router])

  React.useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  const onSubmit = handleSubmit(async (data) => {
    try {
      await createWorkspace(data.name)
      toast({
        variant: 'success',
        title: 'Workspace created',
        description: `${data.name} is ready.`,
      })
      reset()
      setIsModalOpen(false)
      await loadWorkspaces()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      toast({
        variant: 'error',
        title: 'Failed to create workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    }
  })

  return (
    <PageShell contentClassName="pb-16">
      <AppHeader
        title="Workspaces"
        description="Create a workspace, review your access, and jump into knowledge operations."
        badge={<Badge variant="secondary">P2 ready</Badge>}
        actions={
          <Button size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus className="size-4" />
            New workspace
          </Button>
        }
      />

      <div className="space-y-8 py-10">
        <PageSection
          eyebrow={<Badge variant="outline">Tenant access</Badge>}
          title="Your workspaces"
          description="Each workspace keeps its own knowledge bases, documents, and member permissions."
        >
          {isLoading ? (
            <Card variant="elevated" className="space-y-4 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </Card>
          ) : workspaces.length === 0 ? (
            <EmptyState
              icon={<BriefcaseBusiness className="size-5" />}
              title="No workspaces yet"
              description="Create your first workspace to start organizing knowledge."
              actions={
                <Button onClick={() => setIsModalOpen(true)}>
                  <Plus className="size-4" />
                  New workspace
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((workspace) => (
                  <TableRow key={workspace.id}>
                    <TableCell className="font-medium">{workspace.name}</TableCell>
                    <TableCell>
                      <Badge variant={workspace.role === 'owner' ? 'success' : 'secondary'}>{workspace.role}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/workspaces/${workspace.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageSection>
      </div>

      <Modal
        open={isModalOpen}
        onClose={() => {
          if (!isSubmitting) {
            setIsModalOpen(false)
            reset()
          }
        }}
        title="Create workspace"
      >
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label htmlFor="workspace-name" className="text-sm font-medium">
              Workspace name
            </label>
            <Input id="workspace-name" {...register('name')} />
            {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting} loadingText="Creating">
              Create workspace
            </Button>
          </div>
        </form>
      </Modal>
    </PageShell>
  )
}
