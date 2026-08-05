import { afterEach, describe, expect, it } from 'vitest';
import { extractRunToken, isRunAuthorized } from '../../src/app/api/_lib/auth';

const STRONG_TOKEN = 'test-token-16chars';

describe('audit run auth', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
  });

  it('accepts bearer token when configured', () => {
    process.env.AUDITOR_RUN_TOKEN = STRONG_TOKEN;

    const request = new Request('http://localhost/api/audit/run', {
      headers: { authorization: `Bearer ${STRONG_TOKEN}` },
    });

    expect(extractRunToken(request)).toBe(STRONG_TOKEN);
    expect(isRunAuthorized(request)).toBe(true);
  });

  it('accepts x-auditor-run-token header', () => {
    process.env.AUDITOR_RUN_TOKEN = 'header-token-16c';

    const request = new Request('http://localhost/api/audit/run', {
      headers: { 'x-auditor-run-token': 'header-token-16c' },
    });

    expect(isRunAuthorized(request)).toBe(true);
  });

  it('rejects missing or mismatched tokens', () => {
    process.env.AUDITOR_RUN_TOKEN = 'expected-token-16';

    const missing = new Request('http://localhost/api/audit/run');
    const wrong = new Request('http://localhost/api/audit/run', {
      headers: { authorization: 'Bearer wrong-token-16c' },
    });

    expect(isRunAuthorized(missing)).toBe(false);
    expect(isRunAuthorized(wrong)).toBe(false);
  });

  it('rejects short configured tokens even when they match', () => {
    process.env.AUDITOR_RUN_TOKEN = 'short';

    const request = new Request('http://localhost/api/audit/run', {
      headers: { authorization: 'Bearer short' },
    });

    expect(isRunAuthorized(request)).toBe(false);
  });
});
