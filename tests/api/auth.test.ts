import { describe, expect, it } from 'vitest';
import { extractRunToken, isRunAuthorized } from '../../src/app/api/_lib/auth';

describe('audit run auth', () => {
  it('accepts bearer token when configured', () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token';

    const request = new Request('http://localhost/api/audit/run', {
      headers: { authorization: 'Bearer test-token' },
    });

    expect(extractRunToken(request)).toBe('test-token');
    expect(isRunAuthorized(request)).toBe(true);
  });

  it('accepts x-auditor-run-token header', () => {
    process.env.AUDITOR_RUN_TOKEN = 'header-token';

    const request = new Request('http://localhost/api/audit/run', {
      headers: { 'x-auditor-run-token': 'header-token' },
    });

    expect(isRunAuthorized(request)).toBe(true);
  });

  it('rejects missing or mismatched tokens', () => {
    process.env.AUDITOR_RUN_TOKEN = 'expected';

    const missing = new Request('http://localhost/api/audit/run');
    const wrong = new Request('http://localhost/api/audit/run', {
      headers: { authorization: 'Bearer wrong' },
    });

    expect(isRunAuthorized(missing)).toBe(false);
    expect(isRunAuthorized(wrong)).toBe(false);
  });
});
