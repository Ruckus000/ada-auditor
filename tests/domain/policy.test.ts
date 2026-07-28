import { describe, expect, it } from 'vitest';
import { classifyAction, isActionAllowed } from '../../src/domain/policy';

describe('isActionAllowed', () => {
  it('blocks destructive actions in production', () => {
    expect(isActionAllowed('production', 'delete')).toBe(false);
  });

  it('allows safe submissions in staging', () => {
    expect(isActionAllowed('staging', 'submit-safe')).toBe(true);
  });
});

describe('classifyAction', () => {
  it('classifies unknown actions as forbidden', () => {
    expect(classifyAction('launch-missiles')).toBe('forbidden');
  });
});
