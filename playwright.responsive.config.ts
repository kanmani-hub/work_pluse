import { defineConfig } from '@playwright/test';

/**
 * Responsive layout suite (mock backend only).
 *
 * - Does NOT load .env: the dev server is started with a fake Supabase project URL
 *   (https://mockproj.supabase.co) that every test answers from in-memory fixtures.
 * - Every other external host is aborted inside the tests (see tests/responsive/mockSupabase.ts).
 * - Set RESPONSIVE_BASE_URL to reuse an already-running server built with the same fake values.
 *
 * Run: npm run test:responsive
 */
const PORT = Number(process.env.RESPONSIVE_PORT || 5199);
const baseURL = process.env.RESPONSIVE_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/responsive',
  testMatch: /.*\.responsive\.ts$/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-responsive', open: 'never' }]],
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.RESPONSIVE_BASE_URL
    ? undefined
    : {
        command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort --mode responsive-test`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          VITE_SUPABASE_URL: 'https://mockproj.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'mock-anon-key',
          // Existing process env vars take priority over .env files in Vite, so these
          // fake values replace every VITE_* value the app reads.
          VITE_GOOGLE_MAPS_API_KEY: '',
          VITE_QA_FAST_MODE: 'false',
        },
      },
});
