export type WorkspaceRole = 'owner' | 'admin' | 'member'
export type WorkspaceMembership = { id: string; role: WorkspaceRole }

const ROLES: readonly string[] = ['owner', 'admin', 'member']

// The caller's role in one workspace, read from GET /workspaces/:id (`role`,
// set from WorkspaceMemberGuard; packages/types WorkspaceDetail). Never from
// listWorkspaces(): that is page 1 of a paginated list and need not hold this
// workspace. Anything unrecognised is no membership, so manage controls stay
// hidden; the API enforces RolesGuard either way.
export function membershipFrom(workspace: unknown): WorkspaceMembership | null {
  if (typeof workspace !== 'object' || workspace === null) return null
  const { id, role } = workspace as { id?: unknown; role?: unknown }
  if (typeof id !== 'string' || typeof role !== 'string' || !ROLES.includes(role)) return null
  return { id, role: role as WorkspaceRole }
}
