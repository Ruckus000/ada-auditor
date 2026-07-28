import type { PlatformContext } from '../../domain/platforms';
import type { PlatformAdapter } from './types';

export const wordpressAdapter: PlatformAdapter = {
  platform: 'wordpress',
  detect: (input) =>
    input.platformHint === 'wordpress' || /wp-content|wp-includes|wordpress/i.test(input.html),
  enrich: (_context: PlatformContext) => ({
    id: 'wordpress',
    hints: ['theme-plugin-boundary', 'cms-template-repetition'],
  }),
};
