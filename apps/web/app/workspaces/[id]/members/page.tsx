'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AppShell,
  Badge,
  Button,
  EmptyState,
  Eyebrow,
  Input,
  Modal,
  PageSection,
  Pagination,
  Select,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { Mail, Search, Trash2 } from 'lucide-react'
import { getCurrentUser, logout } from '@/lib/api/auth'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, inviteMember, listMembers, listWorkspaces, removeMember } from '@/lib/api/workspaces'
import { formatDate } from '@/lib/format-date'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

const inviteSchema = z.object({ email: z.string().email('Enter a valid email address') })

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type Member = { id: string; userId: string; email: string; role: 'owner' | 'admin' | 'member'; joinedAt: string }
type MemberListResponse = { items: Member[]; page: number; pageSize: number; total: number; totalPages: number }
type RoleFilter = '' | 'owner' | 'admin' | 'member'
type InviteFormData = z.infer<typeof inviteSchema>

const roleLabel: Record<WorkspaceMembership['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

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

  const inviteEmailError = inviteForm.formState.errors.email

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb={`${workspace?.name ?? 'Workspace'} / Workspace`}
      title="Members"
      description="Everyone with access to this workspace."
      badge={membership ? <Badge variant={membership.role === 'member' ? 'neutral' : 'teal'}>{roleLabel[membership.role]}</Badge> : null}
      onLogout={handleLogout}
    >
      <div className="flex flex-col gap-10">
        <PageSection
          eyebrow={<Eyebrow>Collaborators</Eyebrow>}
          title="Invite members"
          description="Invites go out by email. The link joins them to this workspace as a member."
        >
          {canManage ? (
            <form
              className="grid gap-3.5 rounded-[18px] border border-border-panel bg-card px-6 py-[22px] md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
              onSubmit={submitInvite}
            >
              <div className="flex flex-col gap-2">
                <label htmlFor="member-email" className="text-[14px] font-medium">Member email</label>
                <Input
                  id="member-email"
                  type="email"
                  placeholder="teammate@example.com"
                  aria-invalid={inviteEmailError ? true : undefined}
                  {...inviteForm.register('email')}
                />
                {inviteEmailError ? <p className="text-[13px] text-destructive-strong-text">{inviteEmailError.message}</p> : null}
              </div>
              <Button type="submit" isLoading={inviteForm.formState.isSubmitting} loadingText="Sending">
                <Mail className="size-4" />
                Send invite
              </Button>
            </form>
          ) : (
            <EmptyState
              label="Owners & admins"
              labelTone="neutral"
              title="Invite controls hidden"
              description="Only owners and admins can invite members to this workspace."
            />
          )}
        </PageSection>

        <PageSection eyebrow={<Eyebrow>Roster</Eyebrow>} title="Members">
          <Table
            header={
              <div className="flex flex-col gap-3 border-b border-border-inner px-5 py-4 sm:flex-row">
                <div className="relative flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-[14px] top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  />
                  <Input
                    aria-label="Search members"
                    placeholder="Search by email"
                    className="pl-10"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <Select
                  aria-label="Filter by role"
                  className="sm:w-[180px]"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                >
                  <option value="">All roles</option>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </Select>
              </div>
            }
            footer={
              !isLoading && members.length > 0 ? (
                <Pagination
                  page={meta.page}
                  pageSize={meta.pageSize}
                  total={meta.total}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  isLoading={isMembersLoading}
                />
              ) : undefined
            }
          >
            {isLoading ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={4} aria-busy="true" className="px-6 py-4">
                    <SkeletonRows rows={3} columns={4} />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : members.length === 0 ? (
              <TableBody>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="p-5">
                    <EmptyState
                      nested
                      label={debouncedSearch ? `Search · "${debouncedSearch}"` : undefined}
                      title="No members found"
                      description="Try a different search or role filter."
                    />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Email</TableHead>
                    <TableHead className="w-[140px]">Role</TableHead>
                    <TableHead className="w-[140px]">Joined</TableHead>
                    <TableHead className="w-[140px] pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="pl-6">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="truncate font-medium">{member.email}</span>
                          {/* 3.8: says why this row has no Remove. */}
                          {member.userId === currentUserId ? (
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">you</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.role === 'member' ? 'neutral' : 'teal'}>{roleLabel[member.role]}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[13px] text-ink-body">{formatDate(member.joinedAt)}</TableCell>
                      <TableCell className="py-2 pr-[18px] text-right">
                        {membership?.role === 'owner' && member.userId !== currentUserId ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label={`Remove ${member.email}`}
                            className="hover:bg-destructive-tone/8 hover:text-destructive-strong-text"
                            onClick={() => setPendingRemove(member)}
                          >
                            <Trash2 className="size-[15px]" />
                            Remove
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        </PageSection>
      </div>

      <Modal
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        title="Remove member"
        eyebrow="Confirm"
        eyebrowTone="red"
        footer={
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={() => setPendingRemove(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemoveMember()}>Remove member</Button>
          </div>
        }
      >
        {pendingRemove ? (
          <p className="text-[15px] leading-[1.6] text-[oklch(0.36_0.02_264)]">
            Remove <span className="font-mono text-[14px]">{pendingRemove.email}</span> from this workspace?
          </p>
        ) : null}
      </Modal>
    </AppShell>
  )
}
