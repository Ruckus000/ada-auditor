import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The built application, driven in a real browser.
 *
 * Separate from every other suite because it needs `npm run build` first and
 * boots `next start`. It exists because an entirely inert UI once passed the
 * unit suite, the type checker and the build — none of which can see whether
 * the page is alive.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/integrations/browser/platform-hydration.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
