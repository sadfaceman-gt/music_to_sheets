import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build served by `vite preview`,
// which sends the same COOP/COEP headers the coi-serviceworker adds on Pages.
const port = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/music_to_sheets/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/music_to_sheets/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
