import { describe, expect, it } from 'vitest';
import { createAppVersion } from '../src/index';

describe('createAppVersion', () => {
  it('returns the initial application version', () => {
    expect(createAppVersion()).toBe('0.1.0');
  });
});
