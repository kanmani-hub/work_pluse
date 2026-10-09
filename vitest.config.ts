import { defineConfig } from 'vitest/config';

/**
 * Vitest runs UNIT tests only: src/**\/*.test.ts(x).
 * Playwright end-to-end specs (*.spec.ts, tests/) run under the Playwright runner
 * (`npm run test:e2e`), never under Vitest.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**', '**/*.spec.{ts,tsx}', 'playwright-report/**', 'test-results/**'],
    environment: 'node',
  },
});
