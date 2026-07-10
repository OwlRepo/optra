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
import { Plus, Store } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { createVendor, listVendors, type VendorDetail } from '@/lib/api/catalog'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
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
      title="Vendors"
      description="Manage the vendors you source from or verify invoices against."
      badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
      actions={canManage ? <Button size="sm" onClick={() => setIsCreateModalOpen(true)}><Plus className="size-4" />Add vendor</Button> : null}
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
        {isLoading ? (
          <Card variant="elevated" className="space-y-4 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        ) : vendors.length === 0 ? (
          <EmptyState
            icon={<Store className="size-5" />}
            title="No vendors yet"
            description="Add a vendor to start uploading or scraping their catalog."
            actions={canManage ? <Button onClick={() => setIsCreateModalOpen(true)}><Plus className="size-4" />Add vendor</Button> : undefined}
          />
        ) : (
          <Card variant="elevated">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor) => (
                  <TableRow key={vendor.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/workspaces/${workspaceId}/vendors/${vendor.id}`} className="block">
                        {vendor.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/workspaces/${workspaceId}/vendors/${vendor.id}`} className="block">
                        {vendor.contactInfo ?? '—'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/workspaces/${workspaceId}/vendors/${vendor.id}`} className="block">
                        {vendor.createdAt ? new Date(vendor.createdAt).toLocaleDateString() : 'Recently created'}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
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
      >
        <form className="space-y-4" onSubmit={submitVendor}>
          <div className="space-y-2">
            <label htmlFor="vendor-name" className="text-sm font-medium">Vendor name</label>
            <Input id="vendor-name" {...vendorForm.register('name')} />
            {vendorForm.formState.errors.name ? <p className="text-sm text-destructive">{vendorForm.formState.errors.name.message}</p> : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="vendor-contact-info" className="text-sm font-medium">Contact info</label>
            <Input id="vendor-contact-info" {...vendorForm.register('contactInfo')} />
            {vendorForm.formState.errors.contactInfo ? <p className="text-sm text-destructive">{vendorForm.formState.errors.contactInfo.message}</p> : null}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
            <Button type="submit" isLoading={vendorForm.formState.isSubmitting} loadingText="Adding">Add vendor</Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  )
}
