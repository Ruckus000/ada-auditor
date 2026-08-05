import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDefaultDemoJourneySteps,
  getDemoCredentials,
  resolveNavigationUrl,
} from '../../src/integrations/browser/demo-journey';

describe('demo journey auth helpers', () => {
  const originalUser = process.env.AUDIT_DEMO_USER;
  const originalPass = process.env.AUDIT_DEMO_PASS;
  const originalBase = process.env.AUDIT_TARGET_BASE_URL;

  afterEach(() => {
    if (originalUser === undefined) delete process.env.AUDIT_DEMO_USER;
    else process.env.AUDIT_DEMO_USER = originalUser;
    if (originalPass === undefined) delete process.env.AUDIT_DEMO_PASS;
    else process.env.AUDIT_DEMO_PASS = originalPass;
    if (originalBase === undefined) delete process.env.AUDIT_TARGET_BASE_URL;
    else process.env.AUDIT_TARGET_BASE_URL = originalBase;
  });

  it('defaults demo credentials for the local fixture', () => {
    delete process.env.AUDIT_DEMO_USER;
    delete process.env.AUDIT_DEMO_PASS;
    delete process.env.AUDIT_TARGET_BASE_URL;
    expect(getDemoCredentials()).toEqual({ user: 'auditor', pass: 'demo-pass' });
  });

  it('reads demo credentials from the environment', () => {
    process.env.AUDIT_DEMO_USER = 'staging-user';
    process.env.AUDIT_DEMO_PASS = 'staging-secret';
    expect(getDemoCredentials()).toEqual({ user: 'staging-user', pass: 'staging-secret' });
  });

  it('requires explicit demo credentials when AUDIT_TARGET_BASE_URL is remote', () => {
    delete process.env.AUDIT_DEMO_USER;
    delete process.env.AUDIT_DEMO_PASS;
    process.env.AUDIT_TARGET_BASE_URL = 'https://staging.example.com/app/';
    expect(() => getDemoCredentials()).toThrow(/AUDIT_DEMO_USER/);
  });

  it('accepts explicit demo credentials with a remote target base', () => {
    process.env.AUDIT_TARGET_BASE_URL = 'https://staging.example.com/app/';
    process.env.AUDIT_DEMO_USER = 'staging-user';
    process.env.AUDIT_DEMO_PASS = 'staging-secret';
    expect(getDemoCredentials()).toEqual({ user: 'staging-user', pass: 'staging-secret' });
  });

  it('builds fill + submit steps for credential login', () => {
    delete process.env.AUDIT_DEMO_USER;
    delete process.env.AUDIT_DEMO_PASS;
    delete process.env.AUDIT_TARGET_BASE_URL;
    const steps = buildDefaultDemoJourneySteps();
    expect(steps).toEqual([
      { action: 'navigate', type: 'goto', path: 'login.html' },
      { action: 'login', type: 'fill', selector: '#username', value: 'auditor' },
      { action: 'login', type: 'fill', selector: '#password', value: 'demo-pass' },
      { action: 'login', type: 'click', selector: '#login-button' },
    ]);
  });

  it('resolves file URLs when no staging base is set', () => {
    delete process.env.AUDIT_TARGET_BASE_URL;
    const url = resolveNavigationUrl('/tmp/fixtures', 'login.html');
    expect(url.startsWith('file://')).toBe(true);
    expect(url.endsWith('/login.html')).toBe(true);
  });

  it('resolves against AUDIT_TARGET_BASE_URL when set', () => {
    process.env.AUDIT_TARGET_BASE_URL = 'https://staging.example.com/app/';
    expect(resolveNavigationUrl('/tmp/fixtures', 'login.html')).toBe(
      'https://staging.example.com/app/login.html',
    );
  });
});
