import { NotFoundException } from '@nestjs/common'
import { WorkspacesController } from './workspaces.controller'
import type { WorkspacesService } from './workspaces.service'

// GET /workspaces/:workspaceId hands back the caller's role, read from the
// WorkspaceMemberGuard context, so the web never derives it from page 1 of
// the paginated /workspaces/me list.

const row = { id: 'ws-1', name: 'Acme', ownerId: 'user-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }

function controllerWith(getOne: jest.Mock) {
  return new WorkspacesController({ getOne } as unknown as WorkspacesService)
}

describe('WorkspacesController getOne', () => {
  it('error: a missing workspace still surfaces the NotFoundException', async () => {
    const controller = controllerWith(jest.fn().mockRejectedValue(new NotFoundException('Workspace not found')))

    await expect(controller.getOne('ws-1', { workspaceId: 'ws-1', role: 'owner' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it.each(['owner', 'admin', 'member'] as const)(
    'regression: returns the workspace with the caller role %s from the member context',
    async (role) => {
      const getOne = jest.fn().mockResolvedValue(row)
      const controller = controllerWith(getOne)

      await expect(controller.getOne('ws-1', { workspaceId: 'ws-1', role })).resolves.toEqual({ ...row, role })
      expect(getOne).toHaveBeenCalledWith('ws-1')
    },
  )
})
