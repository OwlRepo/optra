import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// What tests/auth.setup.ts seeds, handed to every spec through a file: the
// setup project and the specs run in different worker processes, so module
// state cannot carry it.

export interface Actor {
  email: string
  password: string
  userId: string
  workspaceId: string
}

export interface Owner extends Actor {
  vendorId: string
  knowledgeBaseId: string
}

export interface SeedState {
  run: string
  /** Owns workspace A. Most specs act as this user. */
  ownerA: Owner
  /** Owns workspace B and is a stranger to A: the cross-tenant probe. */
  ownerB: Owner
  /** A `member` of workspace A: can read, cannot upload. */
  memberA: Actor
  /** Registered, never verified - login must refuse it. */
  unverified: { email: string; password: string }
}

export type Role = 'ownerA' | 'ownerB' | 'memberA'

export const AUTH_DIR = join(__dirname, '..', '.auth')
export const STATE_FILE = join(AUTH_DIR, 'state.json')

export function storageStateFor(role: Role): string {
  return join(AUTH_DIR, `${role}.json`)
}

export function loadState(): SeedState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SeedState
}
