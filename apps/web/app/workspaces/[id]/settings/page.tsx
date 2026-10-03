'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AppShell, Button, DefinitionRow, Eyebrow, Input, MicroLabel, Switch, cn, useToast } from '@repo/ui'
import { changePassword, logout } from '@/lib/api/auth'
import { getDigestSettings, previewDigest, updateDigestSettings } from '@/lib/api/digest-settings'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { getWorkspace, updateWorkspace } from '@/lib/api/workspaces'
import { membershipFrom } from '@/lib/workspace-role'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { TOUR_ANCHORS, tourAttr } from '@/components/tour/tour-anchors'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

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

// Frame 3.10: label column (280px) beside the form panel, 1px rule between
// sections. The landing's "Files & trust" shape.
function SettingsSection({
  eyebrow,
  title,
  description,
  last = false,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'grid gap-6 py-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10',
        !last && 'border-b border-border',
      )}
    >
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-3 text-[22px]">{title}</h2>
        <p className="mt-2 text-[14px] leading-[1.6] text-ink-body">{description}</p>
      </div>
      <div className="overflow-hidden rounded-[18px] border border-border-panel bg-card">{children}</div>
    </section>
  )
}

export default function SettingsPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const workspaceId = params.id
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  // B18. Set when the first load answers 403; the page then shows only the
  // no-access state instead of empty content.
  const [accessDenied, setAccessDenied] = React.useState(false)
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
        const workspaceData = await getWorkspace(workspaceId)
        setWorkspace(workspaceData)
        reset({ name: workspaceData?.name ?? '' })
        setRole(membershipFrom(workspaceData)?.role ?? null)
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push('/login')
          return
        }
        if (isForbidden(err)) {
          setAccessDenied(true)
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
  const showDigest = (role === 'owner' || role === 'admin') && digestSettings !== null

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
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb={`${workspace?.name ?? 'Workspace'} / Workspace`}
      title="Settings"
      description="Workspace-level configuration."
      onLogout={handleLogout}
    >
      {/* Frame 3.10 main is `8px 40px 48px`: AppShell's <main> pads 32px on
          top, so -mt-6 brings it back to 8px. */}
      <div className="-mt-6 flex flex-col">
        {accessDenied ? (
          <WorkspaceAccessDenied />
        ) : (
          <>
            <div {...tourAttr(TOUR_ANCHORS.settingsWorkspace)}>
              <SettingsSection eyebrow="Workspace" title="Workspace name" description="Shown in the sidebar and on invites.">
                <form onSubmit={onSubmitRename}>
                  <div className="flex flex-col gap-2 px-6 py-[22px]">
                    <label htmlFor="workspace-name-input" className="text-[14px] font-medium">
                      Workspace name
                    </label>
                    <Input
                      id="workspace-name-input"
                      disabled={!canRename}
                      aria-invalid={errors.name ? true : undefined}
                      {...register('name')}
                    />
                    {errors.name ? <p className="text-[13px] text-destructive-strong-text">{errors.name.message}</p> : null}
                    {role !== null && !canRename ? (
                      <p className="text-[13px] text-ink-muted">Only owners and admins can rename the workspace.</p>
                    ) : null}
                  </div>
                  <DefinitionRow density="roomy" label="Workspace ID" value={workspaceId} className="border-t border-border-definition" />
                  {canRename ? (
                    <div className="flex justify-end border-t border-border-inner bg-surface-subtle px-6 py-3.5">
                      <Button type="submit" size="sm" className="h-[38px] px-4" isLoading={isSubmitting} loadingText="Saving">
                        Save changes
                      </Button>
                    </div>
                  ) : null}
                </form>
              </SettingsSection>
            </div>

            <SettingsSection
              eyebrow="Security"
              title="Change password"
              description="Changing your password signs you out of every other session."
              last={!showDigest}
            >
              <form onSubmit={onSubmitChangePassword}>
                <div className="flex flex-col gap-4 px-6 py-[22px]">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="current-password-input" className="text-[14px] font-medium">
                      Current password
                    </label>
                    <Input
                      id="current-password-input"
                      type="password"
                      autoComplete="current-password"
                      aria-invalid={passwordErrors.currentPassword ? true : undefined}
                      {...registerPassword('currentPassword')}
                    />
                    {passwordErrors.currentPassword ? (
                      <p className="text-[13px] text-destructive-strong-text">{passwordErrors.currentPassword.message}</p>
                    ) : null}
                  </div>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label htmlFor="new-password-input" className="text-[14px] font-medium">
                        New password
                      </label>
                      <Input
                        id="new-password-input"
                        type="password"
                        autoComplete="new-password"
                        aria-invalid={passwordErrors.newPassword ? true : undefined}
                        {...registerPassword('newPassword')}
                      />
                      {passwordErrors.newPassword ? (
                        <p className="text-[13px] text-destructive-strong-text">{passwordErrors.newPassword.message}</p>
                      ) : (
                        <p className="text-[13px] text-ink-muted">At least 8 characters.</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <label htmlFor="confirm-password-input" className="text-[14px] font-medium">
                        Confirm new password
                      </label>
                      <Input
                        id="confirm-password-input"
                        type="password"
                        autoComplete="new-password"
                        aria-invalid={passwordErrors.confirmPassword ? true : undefined}
                        {...registerPassword('confirmPassword')}
                      />
                      {passwordErrors.confirmPassword ? (
                        <p className="text-[13px] text-destructive-strong-text">{passwordErrors.confirmPassword.message}</p>
                      ) : null}
                    </div>
                  </div>
                  {passwordApiError ? <p className="text-[13px] text-destructive-strong-text">{passwordApiError}</p> : null}
                </div>
                <div className="flex justify-end border-t border-border-inner bg-surface-subtle px-6 py-3.5">
                  <Button type="submit" size="sm" className="h-[38px] px-4" isLoading={isChangingPassword} loadingText="Changing">
                    Change password
                  </Button>
                </div>
              </form>
            </SettingsSection>

            {showDigest && digestSettings ? (
              <SettingsSection
                eyebrow="Notifications"
                title="Weekly digest"
                description="A weekly summary of activity, sent by email and/or posted to Slack."
                last
              >
                <div className="flex items-center justify-between gap-4 px-6 py-5">
                  <div>
                    <p className="text-[15px] font-medium">Email digest</p>
                    <p className="mt-1 text-[13px] text-ink-muted">Sent to the workspace owner.</p>
                  </div>
                  <Switch
                    aria-label="Email digest"
                    checked={digestSettings.emailEnabled}
                    disabled={isSavingDigest}
                    onCheckedChange={() => void handleToggleEmail()}
                  />
                </div>

                <div className="flex flex-col gap-2 border-t border-border-definition px-6 py-5">
                  <label htmlFor="slack-webhook-input" className="text-[14px] font-medium">
                    Slack webhook URL
                  </label>
                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <Input
                      id="slack-webhook-input"
                      className="min-w-0 flex-1 font-mono text-[13px]"
                      placeholder="https://hooks.slack.com/services/..."
                      value={slackWebhookInput}
                      onChange={(event) => setSlackWebhookInput(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="px-4"
                      isLoading={isSavingDigest}
                      loadingText="Saving"
                      onClick={() => void handleSaveSlackWebhook()}
                    >
                      Save
                    </Button>
                  </div>
                  {digestSettings.slackEnabled ? (
                    <p className="flex items-center gap-2 text-[13px] text-primary-strong-hover">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary-strong" />
                      Slack posting is enabled.
                    </p>
                  ) : (
                    <p className="text-[13px] text-ink-muted">Leave blank to disable Slack posting.</p>
                  )}
                </div>

                <div className="flex flex-col gap-3 border-t border-border-definition px-6 pb-[22px] pt-4">
                  <div className="flex items-center justify-between gap-4">
                    <MicroLabel>Preview · Slack plain-text form</MicroLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      isLoading={isPreviewingDigest}
                      loadingText="Loading"
                      onClick={() => void handlePreviewDigest()}
                    >
                      Preview digest
                    </Button>
                  </div>

                  {digestPreviewText ? (
                    <pre className="m-0 whitespace-pre-wrap rounded-[12px] border border-border-segmented bg-surface-subtle p-4 font-mono text-[12px] leading-[1.7] text-[oklch(0.36_0.02_264)]">
                      {digestPreviewText}
                    </pre>
                  ) : null}
                </div>
              </SettingsSection>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  )
}
