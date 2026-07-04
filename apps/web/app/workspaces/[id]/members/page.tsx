'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AppShell, Badge, Button, Card, EmptyState, Input, Modal, PageSection, Pagination, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from '@repo/ui'
import { Mail, Search, Trash2 } from 'lucide-react'
import { getCurrentUser, logout } from '@/lib/api/auth'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, inviteMember, listMembers, listWorkspaces, removeMember } from '@/lib/api/workspaces'
import { WorkspaceNav } from '@/components/workspace-nav'

const inviteSchema = z.object({ email: z.string().email('Enter a valid email address') })

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type Member = { id: string; userId: string; email: string; role: 'owner' | 'admin' | 'member'; joinedAt: string }
type MemberListResponse = { items: Member[]; page: number; pageSize: number; total: number; totalPages: number }
type RoleFilter = '' | 'owner' | 'admin' | 'member'
type InviteFormData = z.infer<typeof inviteSchema>

export default function MembersPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const workspaceId = params.id
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [members, setMembers] = React.useState<Member[]>([])
  const [meta, setMeta] = React.useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [roleFilter, setRoleFilter] = React.useState<RoleFilter>('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [isMembersLoading, setIsMembersLoading] = React.useState(false)
  const [pendingRemove, setPendingRemove] = React.useState<Member | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null)

  const inviteForm = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '' },
  })

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'

  // Debounce the search box so we don't fire a request on every keystroke.
  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  // Changing a filter or page size always returns to the first page.
  React.useEffect(() => {
    setPage(1)
  }, [debouncedSearch, roleFilter, pageSize])

  const loadContext = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [workspaceData, memberships, currentUser] = await Promise.all([
        getWorkspace(workspaceId),
        listWorkspaces(),
        getCurrentUser(),
      ])
      setWorkspace(workspaceData)
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
      setCurrentUserId(currentUser?.userId ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to load workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsLoading(false)
    }
  }, [router, toast, workspaceId])

  const fetchMembers = React.useCallback(async () => {
    try {
      setIsMembersLoading(true)
      const data = (await listMembers(workspaceId, {
        page,
        pageSize,
        q: debouncedSearch || undefined,
        role: roleFilter || undefined,
      })) as MemberListResponse
      setMembers(Array.isArray(data?.items) ? data.items : [])
      setMeta({
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? pageSize,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
      })
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to load members',
        description: err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.',
      })
    } finally {
      setIsMembersLoading(false)
    }
  }, [debouncedSearch, page, pageSize, roleFilter, router, toast, workspaceId])

  React.useEffect(() => {
    void loadContext()
  }, [loadContext])

  React.useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

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
      toast({
        variant: 'error',
        title: 'Failed to send invite',
        description: err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.',
      })
    }
  })

  const confirmRemoveMember = React.useCallback(async () => {
    if (!pendingRemove) return
    try {
      await removeMember(workspaceId, pendingRemove.userId)
      toast({
        variant: 'success',
        title: 'Member removed',
        description: `${pendingRemove.email} no longer has access.`,
      })
      setPendingRemove(null)
      await fetchMembers()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to remove member',
        description: err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Try again in a moment.',
      })
    }
  }, [fetchMembers, pendingRemove, router, toast, workspaceId])

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <Link href="/workspaces" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">{workspace?.name?.[0]?.toUpperCase() ?? 'W'}</span>
          {!collapsed ? <span className="truncate">{workspace?.name ?? 'Workspace'}</span> : null}
        </Link>
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      title="Members"
      description="Everyone with access to this workspace."
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
        <PageSection eyebrow={<Badge variant="outline">Collaborators</Badge>} title="Invite members" description="Backend still enforces permissions. This page only shows owner and admin controls when your role is known.">
          <Card variant="elevated" className="p-6">
            {canManage ? (
              <form className="grid gap-4 md:grid-cols-[1fr_auto]" onSubmit={submitInvite}>
                <div className="space-y-2">
                  <label htmlFor="member-email" className="text-sm font-medium">Member email</label>
                  <Input id="member-email" type="email" placeholder="teammate@example.com" {...inviteForm.register('email')} />
                  {inviteForm.formState.errors.email ? <p className="text-sm text-destructive">{inviteForm.formState.errors.email.message}</p> : null}
                </div>
                <div className="flex items-end">
                  <Button type="submit" isLoading={inviteForm.formState.isSubmitting} loadingText="Sending"><Mail className="size-4" />Send invite</Button>
                </div>
              </form>
            ) : (
              <EmptyState icon={<Mail className="size-5" />} title="Invite controls hidden" description="Only owners and admins can invite members to this workspace." />
            )}
          </Card>
        </PageSection>

        <PageSection eyebrow={<Badge variant="outline">Roster</Badge>} title="Members" description="Everyone with access to this workspace.">
          <Card variant="elevated" className="space-y-4 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search members"
                  placeholder="Search by email"
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Select
                aria-label="Filter by role"
                className="sm:w-48"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
              >
                <option value="">All roles</option>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </Select>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : members.length === 0 ? (
              <EmptyState icon={<Search className="size-5" />} title="No members found" description="Try a different search or role filter." />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">{member.email}</TableCell>
                        <TableCell><Badge variant={member.role === 'member' ? 'secondary' : 'success'}>{member.role}</Badge></TableCell>
                        <TableCell>{new Date(member.joinedAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          {membership?.role === 'owner' && member.userId !== currentUserId ? (
                            <Button variant="ghost" size="sm" aria-label={`Remove ${member.email}`} onClick={() => setPendingRemove(member)}><Trash2 className="size-4" />Remove</Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Pagination
                  page={meta.page}
                  pageSize={meta.pageSize}
                  total={meta.total}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  isLoading={isMembersLoading}
                />
              </>
            )}
          </Card>
        </PageSection>
      </div>

      <Modal open={pendingRemove !== null} onClose={() => setPendingRemove(null)} title="Remove member">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{pendingRemove ? `Remove ${pendingRemove.email} from this workspace?` : ''}</p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setPendingRemove(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemoveMember()}>Remove member</Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
