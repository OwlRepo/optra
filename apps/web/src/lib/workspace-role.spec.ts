import { describe, expect, it } from 'vitest'
import { membershipFrom } from './workspace-role'

describe('membershipFrom', () => {
  it('error: null, undefined and non-object responses are no membership', () => {
    expect(membershipFrom(null)).toBeNull()
    expect(membershipFrom(undefined)).toBeNull()
    expect(membershipFrom('ws-1')).toBeNull()
  })

  it('error: a role outside owner/admin/member is no membership, so manage controls stay hidden', () => {
    expect(membershipFrom({ id: 'ws-1', role: 'superadmin' })).toBeNull()
    expect(membershipFrom({ id: 'ws-1', role: 1 })).toBeNull()
  })

  it('edge: a workspace answer without role (API older than this change) is no membership', () => {
    expect(membershipFrom({ id: 'ws-1', name: 'Acme' })).toBeNull()
  })

  it('edge: an answer without a string id is no membership', () => {
    expect(membershipFrom({ role: 'owner' })).toBeNull()
  })

  it('happy: returns id and role for each known role', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(membershipFrom({ id: 'ws-1', name: 'Acme', role })).toEqual({ id: 'ws-1', role })
    }
  })
})
