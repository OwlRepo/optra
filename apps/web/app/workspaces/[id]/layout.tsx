import { WorkspaceProvider } from '@/components/workspace-context'
import { BillingBanner } from '@/components/billing-banner'
import { BillingStopNotice } from '@/components/billing-stop-notice'

// Stays mounted while the user moves between this workspace's pages, so the
// sidebar's workspace name and role load once here, not once per page.
export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  return (
    <WorkspaceProvider key={params.id} workspaceId={params.id}>
      <BillingBanner workspaceId={params.id} />
      <BillingStopNotice workspaceId={params.id} />
      {children}
    </WorkspaceProvider>
  )
}
