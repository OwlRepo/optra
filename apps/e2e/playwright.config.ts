import { defineConfig, devices } from '@playwright/test'
import { API_PORT, API_URL, OPENAI_STUB_PORT, WEB_PORT, WEB_URL, apiEnv, runId } from './support/env'

// The browser suite against the local stack: a real browser, the real Next.js
// server, the real API, Postgres, Redis and SeaweedFS - and a stub in place of
// OpenAI. Production smoke has its own config (playwright.prod.config.ts), so
// neither can pick up the other's tests.
//
// Prerequisites (CI does all three):
//   docker compose up -d --wait postgres redis seaweedfs
//   bunx turbo run build --filter=@repo/api --filter=@repo/web
//   bunx playwright install chromium

const CI = !!process.env.CI
runId() // fix the run id in the runner so every worker inherits the same one

export default defineConfig({
  testDir: './tests',
  // Two workers: enough to overlap the parse queues' waits without making a
  // single upload wait behind a dozen others in one Bull queue.
  workers: 2,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'local',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: [
    {
      command: 'bun stubs/openai-stub.ts',
      url: `http://127.0.0.1:${OPENAI_STUB_PORT}/health`,
      env: { PORT: String(OPENAI_STUB_PORT) },
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      // Recreated before every run, then the production entry point - the
      // same `node dist/main` the API image runs.
      command: 'bun scripts/prepare-db.ts optra_pw && node ../api/dist/main',
      url: `${API_URL}/health`,
      env: apiEnv(),
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'sh scripts/start-web.sh',
      url: `${WEB_URL}/login`,
      env: { PORT: String(WEB_PORT), API_URL: `http://127.0.0.1:${API_PORT}` },
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
})
