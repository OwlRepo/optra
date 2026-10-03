import { WorkspaceProvider } from '@/components/workspace-context'

// Stays mounted while the user moves between this workspace's pages, so the
// sidebar's workspace name and role load once here, not once per page.
export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  return <WorkspaceProvider workspaceId={params.id}>{children}</WorkspaceProvider>
}
