import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/integrations/browser/**/*.test.ts'],
    // The hydration suite needs a build and its own server, so it runs from
    // `npm run test:hydration` rather than here.
    exclude: ['tests/integrations/browser/platform-hydration.test.ts'],
    environment: 'node',
  },
});
