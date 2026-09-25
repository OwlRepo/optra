import { defineConfig, devices } from '@playwright/test'

// Production smoke: the storage paths, through the live UI, against the real
// object store (Backblaze B2). Run by hand after a deploy - never in CI, and
// never by the local suite, which has its own config and its own testDir.
//
//   SMOKE_BASE_URL=https://<domain> SMOKE_EMAIL=... SMOKE_PASSWORD=... \
//     bun run test:smoke
//
// See docs/ops/prod-smoke.md for the one-time account setup and what a run
// leaves behind.

const baseURL = process.env.SMOKE_BASE_URL ?? ''

if (!/^https:\/\//.test(baseURL) || /localhost|127\.0\.0\.1/.test(baseURL)) {
  // Refusing loudly beats "smoke passed" against the wrong server.
  throw new Error('SMOKE_BASE_URL must be the https:// address of the deployed site')
}
if (!process.env.SMOKE_EMAIL || !process.env.SMOKE_PASSWORD) {
  throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required - see docs/ops/prod-smoke.md')
}

export default defineConfig({
  testDir: './smoke',
  // One worker, no retries: one login against a site-wide rate limit, and a
  // smoke failure should be looked at, not retried into a pass.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-smoke' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
