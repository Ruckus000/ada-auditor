import { describe, expect, it } from 'vitest';
import { describePlatformError } from '../../src/app/platform/lib/api-error-copy';

describe('describePlatformError', () => {
  it('translates known platform errors into an action', () => {
    expect(describePlatformError('unauthorized')).toBe('Your session expired. Sign in again, then retry.');
  });

  it('does not put an unknown server code in the primary instruction', () => {
    expect(describePlatformError('new_internal_code', 500)).toBe(
      'The change could not be saved (error 500). Try again.',
    );
  });
});
