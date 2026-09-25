import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test as setup } from '@playwright/test'
import { addMember, closeDb, seedKnowledgeBase, seedUser, seedVendor, seedWorkspace } from '../support/db'
import { runId } from '../support/env'
import { resetBucket } from '../support/s3'
import { AUTH_DIR, STATE_FILE, storageStateFor, type Role, type SeedState } from '../support/state'

// Seeds the actors every spec relies on, then signs each one in through the
// real login form ONCE and saves the session. Specs reuse those sessions, so a
// full run costs three logins against the 10-per-10-minutes limit rather than
// one per test.
//
// Users are seeded straight into the database rather than registered: the
// register route allows five calls per ten minutes from one IP. Registration
// itself is covered once, end to end, in login.spec.ts.

const PASSWORD = 'e2e-Password-1'

setup('seed actors and sign each one in', async ({ browser }) => {
  const run = runId()
  const email = (who: string) => `${run}-${who}@e2e.test`

  await resetBucket()

  const ownerAId = await seedUser({ email: email('owner-a'), password: PASSWORD })
  const workspaceA = await seedWorkspace(ownerAId, `E2E A ${run}`)
  const ownerBId = await seedUser({ email: email('owner-b'), password: PASSWORD })
  const workspaceB = await seedWorkspace(ownerBId, `E2E B ${run}`)
  const memberAId = await seedUser({ email: email('member-a'), password: PASSWORD })
  await addMember(workspaceA, memberAId, 'member')
  await seedUser({ email: email('unverified'), password: PASSWORD, verified: false })

  const state: SeedState = {
    run,
    ownerA: {
      email: email('owner-a'),
      password: PASSWORD,
      userId: ownerAId,
      workspaceId: workspaceA,
      vendorId: await seedVendor(workspaceA, 'E2E Vendor A'),
      knowledgeBaseId: await seedKnowledgeBase(workspaceA, 'E2E KB A'),
    },
    ownerB: {
      email: email('owner-b'),
      password: PASSWORD,
      userId: ownerBId,
      workspaceId: workspaceB,
      vendorId: await seedVendor(workspaceB, 'E2E Vendor B'),
      knowledgeBaseId: await seedKnowledgeBase(workspaceB, 'E2E KB B'),
    },
    memberA: { email: email('member-a'), password: PASSWORD, userId: memberAId, workspaceId: workspaceA },
    unverified: { email: email('unverified'), password: PASSWORD },
  }
  await closeDb()

  mkdirSync(AUTH_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

  const roles: Role[] = ['ownerA', 'ownerB', 'memberA']
  for (const role of roles) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/login')
    await page.locator('#email').fill(state[role].email)
    await page.locator('#password').fill(state[role].password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // /chat redirects into the user's workspace; landing there proves the
    // BFF set both cookies and the middleware accepted them.
    await expect(page).toHaveURL(new RegExp(`/workspaces/${state[role].workspaceId}/`))
    await context.storageState({ path: storageStateFor(role) })
    await context.close()
  }
})
