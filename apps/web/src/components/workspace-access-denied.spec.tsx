/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceAccessDenied } from './workspace-access-denied'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

// B14. What a person sees on a workspace page they cannot open: a stale link,
// a shared link, or a workspace that was deleted.
describe('WorkspaceAccessDenied (B14)', () => {
  afterEach(() => {
    cleanup()
    pushMock.mockReset()
  })

  it('happy: says the workspace cannot be opened and leads back to the workspace list', () => {
    render(React.createElement(WorkspaceAccessDenied))

    expect(screen.getByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
    expect(screen.getByText("It may have been deleted, or you're not a member. Ask its owner to invite you.")).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Go to your workspaces' }))
    expect(pushMock).toHaveBeenCalledWith('/workspaces')
  })
})
