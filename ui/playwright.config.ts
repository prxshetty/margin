import { defineConfig } from '@playwright/test'
import { E2E_UI_BASE, isolatedWebServers } from './e2e/isolated-env'

// The suite runs against its own backend + UI (see e2e/isolated-env.ts), never
// the app on :8000 / :5173, so tests can't touch the user's settings or workspaces.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './e2e/global-teardown.ts',
  webServer: isolatedWebServers(),
  use: {
    baseURL: E2E_UI_BASE,
    channel: 'chrome',
    viewport: { width: 1366, height: 850 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        channel: 'chrome',
      },
    },
  ],
})
