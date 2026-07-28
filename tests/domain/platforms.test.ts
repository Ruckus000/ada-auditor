import { describe, expect, it } from 'vitest';
import { createPlatformContext } from '../../src/domain/platforms';

describe('createPlatformContext', () => {
  it('preserves a supported explicit platform hint', () => {
    const context = createPlatformContext({
      platformHint: 'react',
    });

    expect(context.platform).toBe('react');
    expect(context.capabilities.componentSourceHints).toBe(true);
  });

  it('falls back to generic when the platform is unknown', () => {
    const context = createPlatformContext({
      platformHint: 'unknown',
    });

    expect(context.platform).toBe('generic');
    expect(context.capabilities.componentSourceHints).toBe(false);
  });
});
