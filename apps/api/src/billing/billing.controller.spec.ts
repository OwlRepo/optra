import 'reflect-metadata'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { BillingController } from './billing.controller'
import type { BillingService } from './billing.service'

const WS = '11111111-1111-4111-8111-111111111111'
const user = { userId: 'user-1', email: 'owner@example.com' }

function controllerWith(service: Partial<Record<'summary' | 'createCheckout' | 'portalUrl', jest.Mock>> = {}) {
  return new BillingController(service as unknown as BillingService)
}

const proto = BillingController.prototype as unknown as Record<'summary' | 'checkout' | 'portal', () => unknown>
const guardsOf = (name: 'summary' | 'checkout' | 'portal') => Reflect.getMetadata('__guards__', proto[name]) as unknown[]
const rolesOf = (name: 'summary' | 'checkout' | 'portal') => Reflect.getMetadata('roles', proto[name]) as string[] | undefined

describe('BillingController', () => {
  it.each(['checkout', 'portal'] as const)('error: %s requires the owner role', (name) => {
    expect(guardsOf(name)).toContain(RolesGuard)
    expect(rolesOf(name)).toEqual(['owner'])
  })

  it.each(['summary', 'checkout', 'portal'] as const)(
    'error: %s uses JwtAuthGuard then WorkspaceMemberGuard',
    (name) => {
      const guards = guardsOf(name)
      expect(guards).toContain(JwtAuthGuard)
      expect(guards).toContain(WorkspaceMemberGuard)
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(guards.indexOf(WorkspaceMemberGuard))
    },
  )

  it('edge: summary has no role restriction', () => {
    expect(rolesOf('summary')).toBeUndefined()
    expect(guardsOf('summary')).not.toContain(RolesGuard)
  })

  it('edge: checkout passes the route workspace id and the caller email', async () => {
    const createCheckout = jest.fn().mockResolvedValue({ url: 'https://ls.test/c' })

    await controllerWith({ createCheckout }).checkout(WS, user, { plan: 'team', seats: 3 })

    expect(createCheckout).toHaveBeenCalledWith(WS, 'owner@example.com', { plan: 'team', seats: 3 })
  })

  it('happy: summary delegates to the service', async () => {
    const summary = jest.fn().mockResolvedValue({ state: 'trialing' })

    await expect(controllerWith({ summary }).summary(WS)).resolves.toEqual({ state: 'trialing' })
    expect(summary).toHaveBeenCalledWith(WS)
  })
})
