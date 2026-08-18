// The demo tenant: one verified user (plus a teammate to make reviewer/
// assignee attribution look real), one workspace, three knowledge bases.
//
// The workspace + workspace_members rows are created here rather than left to
// the app because only AuthService.verifyOtp() normally creates them
// (apps/api/src/auth/auth.service.ts) — a seeded user would otherwise log in
// to an empty workspace picker.
import {
  DEMO_TEAMMATE_EMAIL,
  DEMO_TEAMMATE_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_WORKSPACE_ID,
  DEMO_WORKSPACE_NAME,
  KB_HELP_CENTER_ID,
  KB_PRODUCT_DOCS_ID,
  KB_RUNBOOKS_ID,
  daysAgo,
} from '../config'

export function buildUsers(passwordHash: string) {
  return [
    {
      id: DEMO_USER_ID,
      email: DEMO_USER_EMAIL,
      passwordHash,
      // login() throws ForbiddenException unless this is true.
      isVerified: true,
      createdAt: daysAgo(120),
    },
    {
      id: DEMO_TEAMMATE_ID,
      email: DEMO_TEAMMATE_EMAIL,
      passwordHash,
      isVerified: true,
      createdAt: daysAgo(96),
    },
  ]
}

export function buildWorkspace() {
  return {
    id: DEMO_WORKSPACE_ID,
    name: DEMO_WORKSPACE_NAME,
    ownerId: DEMO_USER_ID,
    createdAt: daysAgo(120),
  }
}

export function buildMembers() {
  return [
    {
      workspaceId: DEMO_WORKSPACE_ID,
      userId: DEMO_USER_ID,
      role: 'owner' as const,
      joinedAt: daysAgo(120),
      // Left null on purpose: the dashboard derives its unread-activity badge
      // from this column, so a null makes the seeded events read as unseen.
      eventsSeenAt: null,
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      userId: DEMO_TEAMMATE_ID,
      role: 'admin' as const,
      joinedAt: daysAgo(96),
      eventsSeenAt: daysAgo(3),
    },
  ]
}

export function buildKnowledgeBases() {
  return [
    {
      id: KB_PRODUCT_DOCS_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Product Docs',
      createdAt: daysAgo(119),
    },
    {
      id: KB_HELP_CENTER_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Help Center',
      createdAt: daysAgo(118),
    },
    {
      id: KB_RUNBOOKS_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Engineering Runbooks',
      createdAt: daysAgo(90),
    },
  ]
}
