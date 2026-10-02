import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { ParseUUIDPipe } from '@nestjs/common'
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum'

// B16. B13 parsed the catalog routes' path ids; the same 500 (Postgres 22P02
// on a malformed uuid) remained on every other controller that took an id from
// the path unparsed. This walks every controller under src/, so a route added
// later with a bare id fails here. :workspaceId is left to WorkspaceMemberGuard,
// which rejects a malformed one with 403 before any pipe runs.
function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return controllerFiles(path)
    return entry.endsWith('.controller.ts') ? [path] : []
  })
}

function pathIds() {
  const found: { route: string; parsed: boolean }[] = []
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const exported = require(file) as Record<string, unknown>
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function' || !Reflect.hasMetadata(PATH_METADATA, candidate)) continue
      const controller = candidate as { name: string; prototype: object }
      for (const handler of Object.getOwnPropertyNames(controller.prototype)) {
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) as
          | Record<string, { data?: unknown; pipes?: unknown[] }>
          | undefined
        for (const [key, arg] of Object.entries(args ?? {})) {
          const isPathParam = Number(key.split(':')[0]) === RouteParamtypes.PARAM
          if (!isPathParam || typeof arg.data !== 'string' || !arg.data.endsWith('Id') || arg.data === 'workspaceId') {
            continue
          }
          const parsed = arg.pipes?.some((pipe) => pipe instanceof ParseUUIDPipe || pipe === ParseUUIDPipe) ?? false
          found.push({ route: `${controller.name}.${handler}(:${arg.data})`, parsed })
        }
      }
    }
  }
  return found
}

describe('path ids across every controller (B16)', () => {
  it('error: every id taken from a URL path is parsed as a UUID before the handler runs', () => {
    const ids = pathIds()

    // Guard against a vacuous pass: the walk must reach controllers in several modules.
    expect(ids.map((id) => id.route)).toEqual(
      expect.arrayContaining([
        'WorkspacesController.remove(:userId)',
        'TicketsController.getOne(:ticketId)',
        'CatalogController.getVendor(:vendorId)',
      ]),
    )
    expect(ids.filter((id) => !id.parsed).map((id) => id.route)).toEqual([])
  })
})
