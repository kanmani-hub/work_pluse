import { defineConfig } from 'vitest/config';

/**
 * Vitest runs UNIT tests only: src/**\/*.test.ts(x) and supabase/functions/**\/*.test.ts.
 * Playwright end-to-end specs (*.spec.ts, tests/) run under the Playwright runner
 * (`npm run test:e2e`), never under Vitest.
 */
export default defineConfig({
  test: {
    // supabase/functions/**: pure rule modules shared by the edge functions (no Deno imports).
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**', '**/*.spec.{ts,tsx}', 'playwright-report/**', 'test-results/**'],
    environment: 'node',
  },
});
