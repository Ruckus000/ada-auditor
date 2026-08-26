import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDefaultDemoJourneySteps,
  resolveNavigationUrl,
} from '../../src/integrations/browser/demo-journey';
import {
  CredentialError,
  resolveCredential,
  resolveCredentialFrom,
} from '../../src/integrations/browser/credentials';

/**
 * These cases previously covered `getDemoCredentials()`, which read a single
 * global `AUDIT_DEMO_USER` / `AUDIT_DEMO_PASS` pair. That shape could only ever
 * describe one login, so it did not survive supporting more than one client.
 * Journeys now name a credential and the value is resolved server-side.
 */
describe('resolveCredential', () => {
  const KEYS = ['AUDIT_CREDENTIAL_ACME_USER', 'AUDIT_CREDENTIAL_ACME_PASS'];

  afterEach(() => {
    for (const key of KEYS) {
      delete process.env[key];
    }
  });

  it('resolves a reference to its configured value', () => {
    process.env.AUDIT_CREDENTIAL_ACME_USER = 'acme-operator';
    process.env.AUDIT_CREDENTIAL_ACME_PASS = 'acme-secret';

    expect(resolveCredential('acme', 'user')).toBe('acme-operator');
    expect(resolveCredential('acme', 'pass')).toBe('acme-secret');
  });

  it('accepts hyphenated references', () => {
    process.env.AUDIT_CREDENTIAL_ACME_USER = 'acme-operator';

    expect(resolveCredential('ACME', 'user')).toBe('acme-operator');
  });

  it('fails when the credential is not configured', () => {
    expect(() => resolveCredential('acme', 'pass')).toThrow(CredentialError);
  });

  it('never puts the secret in the error message', () => {
    process.env.AUDIT_CREDENTIAL_ACME_USER = 'acme-operator';

    try {
      resolveCredential('acme', 'pass');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('acme');
      expect((error as Error).message).not.toContain('acme-operator');
    }
  });

  it.each(['../../etc', 'a b', 'PATH; rm -rf /', '', 'x'.repeat(65)])(
    'refuses the malformed reference %j rather than building an env key from it',
    (ref) => {
      expect(() => resolveCredential(ref, 'user')).toThrow(CredentialError);
    },
  );
});

/**
 * The resolution order the credential store introduced: what the run was
 * handed wins, the environment carries everything else, and a ref neither can
 * answer fails exactly as it always has. This is the one place that order is
 * written down, which is why it gets its own cases rather than riding on the
 * browser suite's login walk.
 */
describe('resolveCredentialFrom', () => {
  const KEYS = ['AUDIT_CREDENTIAL_ACME_USER', 'AUDIT_CREDENTIAL_ACME_PASS'];

  afterEach(() => {
    for (const key of KEYS) {
      delete process.env[key];
    }
  });

  it('prefers the stored value over the environment', () => {
    process.env.AUDIT_CREDENTIAL_ACME_PASS = 'env-value';

    expect(
      resolveCredentialFrom({ acme: { user: 'stored-user', pass: 'stored-pass' } }, 'acme', 'pass'),
    ).toBe('stored-pass');
  });

  it('falls back to the environment for a ref the map does not carry', () => {
    process.env.AUDIT_CREDENTIAL_ACME_USER = 'env-user';

    expect(resolveCredentialFrom({ other: { user: 'x' } }, 'acme', 'user')).toBe('env-user');
    expect(resolveCredentialFrom(undefined, 'acme', 'user')).toBe('env-user');
  });

  it('falls back per field, not per ref', () => {
    // The seam's fields are optional — what a caller resolved is what it
    // resolved — so a map that answers `user` must not swallow `pass`.
    process.env.AUDIT_CREDENTIAL_ACME_PASS = 'env-pass';

    expect(resolveCredentialFrom({ acme: { user: 'stored-user' } }, 'acme', 'pass')).toBe(
      'env-pass',
    );
  });

  it('treats an empty stored value as absent, matching the env rule', () => {
    process.env.AUDIT_CREDENTIAL_ACME_USER = 'env-user';

    expect(resolveCredentialFrom({ acme: { user: '' } }, 'acme', 'user')).toBe('env-user');
  });

  it('fails a ref missing from both with the sentence the screens explain', () => {
    // The exact text, not just the error class: the editor's copy and the
    // run-failure mapping both talk about this sentence, and the store must
    // not have changed it.
    expect(() => resolveCredentialFrom({}, 'acme', 'pass')).toThrow(
      'Credential "acme" has no pass configured.',
    );
    expect(() => resolveCredentialFrom({}, 'acme', 'pass')).toThrow(CredentialError);
  });
});

describe('buildDefaultDemoJourneySteps', () => {
  it('drives the fixture login form', () => {
    const steps = buildDefaultDemoJourneySteps();

    expect(steps[0]).toMatchObject({ type: 'goto', path: 'login.html' });
    expect(steps.at(-1)).toMatchObject({ type: 'click', selector: '#login-button' });
  });

  it('classifies its actions so environment policy can gate them', () => {
    const actions = new Set(buildDefaultDemoJourneySteps().map((step) => step.action));

    expect(actions).toEqual(new Set(['navigate', 'login']));
  });
});

describe('resolveNavigationUrl', () => {
  it('builds a file URL for fixture runs', () => {
    const url = resolveNavigationUrl('/fixtures/journey-app', 'login.html');

    expect(url.startsWith('file://')).toBe(true);
    expect(url.endsWith('/fixtures/journey-app/login.html')).toBe(true);
  });

  it('resolves against the run target when one is given', () => {
    expect(resolveNavigationUrl('/fixtures', 'dashboard.html', 'https://staging.example.com')).toBe(
      'https://staging.example.com/dashboard.html',
    );
  });

  it('keeps the resolved path inside the target, with or without a trailing slash', () => {
    // A target of `.../app` must not resolve `dashboard.html` to the root —
    // the app being audited may not own the whole origin.
    for (const target of ['https://staging.example.com/app', 'https://staging.example.com/app/']) {
      expect(resolveNavigationUrl('/fixtures', 'dashboard.html', target)).toBe(
        'https://staging.example.com/app/dashboard.html',
      );
    }
  });
});
