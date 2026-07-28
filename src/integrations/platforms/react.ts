import type { PlatformContext } from '../../domain/platforms';
import type { PlatformAdapter } from './types';

export const reactAdapter: PlatformAdapter = {
  platform: 'react',
  detect: (input) =>
    input.platformHint === 'react' || /data-reactroot|__next/i.test(input.html),
  enrich: (_context: PlatformContext) => ({
    id: 'react',
    hints: ['spa-navigation', 'component-source-hints'],
  }),
};
