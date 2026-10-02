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
  EmptyState,
  Input,
  Modal,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { Plus } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { createVendor, listVendors, type VendorDetail } from '@/lib/api/catalog'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import { formatDate } from '@/lib/format-date'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required').max(300, 'Vendor name is too long'),
  contactInfo: z.string().trim().max(1000, 'Contact info is too long').optional(),
})

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type VendorFormData = z.infer<typeof vendorSchema>

const roleLabel: Record<WorkspaceMembership['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

// The modal's submit button sits in the docked footer (C13), outside the
// <form>, and joins it through the `form` attribute.
const ADD_VENDOR_FORM_ID = 'add-vendor-form'

export default function VendorsPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const workspaceId = params.id
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [vendors, setVendors] = React.useState<VendorDetail[]>([])
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false)

  const vendorForm = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
    defaultValues: { name: '', contactInfo: '' },
  })

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [workspaceData, vendorData, memberships] = await Promise.all([
        getWorkspace(workspaceId),
        listVendors(workspaceId),
        listWorkspaces(),
      ])
      setWorkspace(workspaceData)
      setVendors(Array.isArray(vendorData) ? vendorData : [])
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to load vendors',
        description: extractErrorMessage(err, 'Try again in a moment.'),
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

  const submitVendor = vendorForm.handleSubmit(async (data) => {
    try {
      await createVendor(workspaceId, {
        name: data.name,
        contactInfo: data.contactInfo ? data.contactInfo : undefined,
      })
      toast({
        variant: 'success',
        title: 'Vendor added',
      })
      vendorForm.reset()
      setIsCreateModalOpen(false)
      await loadPage()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Failed to add vendor',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    }
  })

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb={`${workspace?.name ?? 'Workspace'} / Matching`}
      title="Vendors"
      description="Manage the vendors you source from or verify invoices against."
      badge={membership ? <Badge variant={membership.role === 'member' ? 'neutral' : 'teal'}>{roleLabel[membership.role]}</Badge> : null}
      actions={canManage ? <Button size="sm" onClick={() => setIsCreateModalOpen(true)}><Plus className="size-4" />Add vendor</Button> : null}
      onLogout={handleLogout}
    >
      <div className="flex flex-col gap-6">
        {isLoading ? (
          <div aria-busy="true" className="rounded-[18px] border border-border-panel bg-card px-6 py-4">
            <SkeletonRows rows={3} columns={3} />
          </div>
        ) : vendors.length === 0 ? (
          <EmptyState
            label="Vendors"
            title="No vendors yet"
            description="Add a vendor to start uploading or scraping their catalog."
            actions={canManage ? <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>Add vendor</Button> : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="w-[130px]">Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((vendor) => (
                <TableRow key={vendor.id} className="relative cursor-pointer">
                  <TableCell className="py-3.5 pl-6 font-medium">
                    {/* One row-level link (3.4): its ::after covers the whole
                        row, so any cell opens the vendor and the row reads as
                        one link to assistive tech. */}
                    <Link
                      href={`/workspaces/${workspaceId}/vendors/${vendor.id}`}
                      className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
                    >
                      {vendor.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-0 truncate py-3.5 text-[14px] text-ink-body">{vendor.contactInfo ?? '—'}</TableCell>
                  <TableCell className="py-3.5 font-mono text-[13px] text-ink-body">
                    {vendor.createdAt ? formatDate(vendor.createdAt) : 'Recently created'}
                  </TableCell>
                  <TableCell aria-hidden="true" className="py-3.5 pr-5 text-right text-ink-muted">
                    →
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Modal
        open={isCreateModalOpen}
        onClose={() => {
          if (!vendorForm.formState.isSubmitting) {
            setIsCreateModalOpen(false)
            vendorForm.reset()
          }
        }}
        title="Add vendor"
        eyebrow="New"
        footer={
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
            <Button type="submit" form={ADD_VENDOR_FORM_ID} isLoading={vendorForm.formState.isSubmitting} loadingText="Adding">Add vendor</Button>
          </div>
        }
      >
        <form id={ADD_VENDOR_FORM_ID} className="flex flex-col gap-4" onSubmit={submitVendor}>
          <div className="flex flex-col gap-2">
            <label htmlFor="vendor-name" className="text-[14px] font-medium">Vendor name</label>
            <Input id="vendor-name" aria-invalid={vendorForm.formState.errors.name ? true : undefined} {...vendorForm.register('name')} />
            {vendorForm.formState.errors.name ? <p className="text-[13px] text-destructive-strong-text">{vendorForm.formState.errors.name.message}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="vendor-contact-info" className="text-[14px] font-medium">
              Contact info <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <Input
              id="vendor-contact-info"
              placeholder="Email, phone or account rep"
              aria-invalid={vendorForm.formState.errors.contactInfo ? true : undefined}
              {...vendorForm.register('contactInfo')}
            />
            {vendorForm.formState.errors.contactInfo ? <p className="text-[13px] text-destructive-strong-text">{vendorForm.formState.errors.contactInfo.message}</p> : null}
          </div>
        </form>
      </Modal>
    </AppShell>
  )
}
