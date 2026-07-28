import type { PlatformContext } from '../../domain/platforms';
import type { PlatformAdapter } from './types';

export const genericAdapter: PlatformAdapter = {
  platform: 'generic',
  detect: () => true,
  enrich: (_context: PlatformContext) => ({
    id: 'generic',
    hints: ['rendered-dom-baseline'],
  }),
};
