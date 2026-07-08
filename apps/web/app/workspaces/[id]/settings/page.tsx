'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AppShell, Badge, Button, Input, PageSection, useToast } from '@repo/ui'
import { changePassword, logout } from '@/lib/api/auth'
import { getDigestSettings, previewDigest, updateDigestSettings } from '@/lib/api/digest-settings'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces, updateWorkspace } from '@/lib/api/workspaces'
import { WorkspaceNav } from '@/components/workspace-nav'

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type DigestSettings = { emailEnabled: boolean; slackWebhookUrl: string | null; slackEnabled: boolean }

const renameSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(255, 'Workspace name is too long'),
})

type RenameFormData = z.infer<typeof renameSchema>

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>

export default function SettingsPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const workspaceId = params.id
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [role, setRole] = React.useState<WorkspaceMembership['role'] | null>(null)
  const [digestSettings, setDigestSettings] = React.useState<DigestSettings | null>(null)
  const [slackWebhookInput, setSlackWebhookInput] = React.useState('')
  const [isSavingDigest, setIsSavingDigest] = React.useState(false)
  const [isPreviewingDigest, setIsPreviewingDigest] = React.useState(false)
  const [digestPreviewText, setDigestPreviewText] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RenameFormData>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: '' },
  })

  const [passwordApiError, setPasswordApiError] = React.useState<string | null>(null)

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    reset: resetPasswordForm,
    formState: { errors: passwordErrors, isSubmitting: isChangingPassword },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  React.useEffect(() => {
    const loadPage = async () => {
      try {
        const [workspaceData, memberships] = await Promise.all([
          getWorkspace(workspaceId),
          listWorkspaces(),
        ])
        setWorkspace(workspaceData)
        reset({ name: workspaceData?.name ?? '' })

        const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
        const membership = membershipItems.find(
          (entry: WorkspaceMembership) => entry.id === workspaceId,
        )
        setRole(membership?.role ?? null)
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
      }
    }
    void loadPage()
  }, [reset, router, toast, workspaceId])

  React.useEffect(() => {
    if (role !== 'owner' && role !== 'admin') return
    void getDigestSettings(workspaceId)
      .then((data) => {
        setDigestSettings(data);
        setSlackWebhookInput(data?.slackWebhookUrl ?? '');
      })
      .catch((err) => {
        if (isUnauthorized(err)) router.push('/login')
      })
  }, [role, router, workspaceId])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  const canRename = role === 'owner' || role === 'admin'

  const onSubmitRename = handleSubmit(async (data) => {
    try {
      const updated = await updateWorkspace(workspaceId, data.name)
      setWorkspace(updated)
      reset({ name: updated.name })
      toast({
        variant: 'success',
        title: 'Workspace renamed',
        description: `Now called ${updated.name}.`,
      })
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to rename workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    }
  })

  const onSubmitChangePassword = handlePasswordSubmit(async (data) => {
    setPasswordApiError(null)
    try {
      await changePassword(data.currentPassword, data.newPassword)
      toast({
        variant: 'success',
        title: 'Password changed',
        description: 'Please log in again with your new password.',
      })
      resetPasswordForm()
      await logout()
      router.push('/login')
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Try again in a moment.'
      setPasswordApiError(message)
    }
  })

  const handleToggleEmail = async () => {
    if (!digestSettings) return
    setIsSavingDigest(true)
    try {
      const updated = await updateDigestSettings(workspaceId, { emailEnabled: !digestSettings.emailEnabled })
      setDigestSettings(updated)
      toast({ variant: 'success', title: 'Digest settings updated' })
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to update digest settings',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsSavingDigest(false)
    }
  }

  const handleSaveSlackWebhook = async () => {
    setIsSavingDigest(true)
    try {
      const updated = await updateDigestSettings(workspaceId, {
        slackWebhookUrl: slackWebhookInput.trim() || null,
      })
      setDigestSettings(updated)
      toast({ variant: 'success', title: 'Slack webhook saved' })
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to save Slack webhook',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsSavingDigest(false)
    }
  }

  const handlePreviewDigest = async () => {
    setIsPreviewingDigest(true)
    try {
      const data = await previewDigest(workspaceId)
      // Plain-text (Slack) form is shown, not the raw HTML — avoids ever
      // needing dangerouslySetInnerHTML for content that could later include
      // free text (e.g. a topic-gap label).
      setDigestPreviewText(data?.slackPayload?.text ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to load digest preview',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsPreviewingDigest(false)
    }
  }

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <Link href="/workspaces" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">{workspace?.name?.[0]?.toUpperCase() ?? 'W'}</span>
          {!collapsed ? <span className="truncate">{workspace?.name ?? 'Workspace'}</span> : null}
        </Link>
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      title="Settings"
      description="Workspace-level configuration."
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
        <PageSection
          eyebrow={<Badge variant="outline">Workspace</Badge>}
          title="Workspace name"
          description={`Workspace ID: ${workspaceId}`}
        >
          <form className="space-y-4" onSubmit={onSubmitRename}>
            <div className="space-y-2">
              <label htmlFor="workspace-name-input" className="text-sm font-medium">
                Workspace name
              </label>
              <Input id="workspace-name-input" disabled={!canRename} {...register('name')} />
              {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
            </div>
            {canRename ? (
              <div className="flex justify-end">
                <Button type="submit" isLoading={isSubmitting} loadingText="Saving">
                  Save changes
                </Button>
              </div>
            ) : null}
          </form>
        </PageSection>

        <PageSection
          eyebrow={<Badge variant="outline">Security</Badge>}
          title="Change password"
          description="Changing your password signs you out of every other session."
        >
          <form className="space-y-4" onSubmit={onSubmitChangePassword}>
            <div className="space-y-2">
              <label htmlFor="current-password-input" className="text-sm font-medium">
                Current password
              </label>
              <Input
                id="current-password-input"
                type="password"
                autoComplete="current-password"
                {...registerPassword('currentPassword')}
              />
              {passwordErrors.currentPassword ? (
                <p className="text-sm text-destructive">{passwordErrors.currentPassword.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label htmlFor="new-password-input" className="text-sm font-medium">
                New password
              </label>
              <Input
                id="new-password-input"
                type="password"
                autoComplete="new-password"
                {...registerPassword('newPassword')}
              />
              {passwordErrors.newPassword ? (
                <p className="text-sm text-destructive">{passwordErrors.newPassword.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm-password-input" className="text-sm font-medium">
                Confirm new password
              </label>
              <Input
                id="confirm-password-input"
                type="password"
                autoComplete="new-password"
                {...registerPassword('confirmPassword')}
              />
              {passwordErrors.confirmPassword ? (
                <p className="text-sm text-destructive">{passwordErrors.confirmPassword.message}</p>
              ) : null}
            </div>
            {passwordApiError ? <p className="text-sm text-destructive">{passwordApiError}</p> : null}
            <div className="flex justify-end">
              <Button type="submit" isLoading={isChangingPassword} loadingText="Changing">
                Change password
              </Button>
            </div>
          </form>
        </PageSection>

        {(role === 'owner' || role === 'admin') && digestSettings ? (
          <PageSection
            eyebrow={<Badge variant="outline">Notifications</Badge>}
            title="Weekly digest"
            description="A weekly summary of activity, sent by email and/or posted to Slack."
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Email digest</p>
                  <p className="text-xs text-muted-foreground">Sent to the workspace owner.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={digestSettings.emailEnabled ? 'default' : 'ghost'}
                  isLoading={isSavingDigest}
                  onClick={() => void handleToggleEmail()}
                >
                  {digestSettings.emailEnabled ? 'On' : 'Off'}
                </Button>
              </div>

              <div className="space-y-2">
                <label htmlFor="slack-webhook-input" className="text-sm font-medium">
                  Slack webhook URL
                </label>
                <div className="flex gap-2">
                  <Input
                    id="slack-webhook-input"
                    placeholder="https://hooks.slack.com/services/..."
                    value={slackWebhookInput}
                    onChange={(event) => setSlackWebhookInput(event.target.value)}
                  />
                  <Button
                    type="button"
                    isLoading={isSavingDigest}
                    loadingText="Saving"
                    onClick={() => void handleSaveSlackWebhook()}
                  >
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {digestSettings.slackEnabled ? 'Slack posting is enabled.' : 'Leave blank to disable Slack posting.'}
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  isLoading={isPreviewingDigest}
                  loadingText="Loading"
                  onClick={() => void handlePreviewDigest()}
                >
                  Preview digest
                </Button>
              </div>

              {digestPreviewText ? (
                <pre className="whitespace-pre-wrap rounded-lg border border-border/70 p-4 text-sm">
                  {digestPreviewText}
                </pre>
              ) : null}
            </div>
          </PageSection>
        ) : null}
      </div>
    </AppShell>
  )
}
