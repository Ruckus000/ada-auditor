import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { JourneyStep } from './types';

export function isRemoteTargetBaseUrl(base?: string): boolean {
  const candidate = base ?? process.env.AUDIT_TARGET_BASE_URL;
  if (!candidate) {
    return false;
  }

  try {
    const protocol = new URL(candidate).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function getDemoCredentials(): { user: string; pass: string } {
  const user = process.env.AUDIT_DEMO_USER;
  const pass = process.env.AUDIT_DEMO_PASS;

  if (isRemoteTargetBaseUrl()) {
    if (!user || !pass) {
      throw new Error(
        'AUDIT_DEMO_USER and AUDIT_DEMO_PASS are required when AUDIT_TARGET_BASE_URL is set',
      );
    }
    return { user, pass };
  }

  return {
    user: user ?? 'auditor',
    pass: pass ?? 'demo-pass',
  };
}

export function buildDefaultDemoJourneySteps(): JourneyStep[] {
  const { user, pass } = getDemoCredentials();
  return [
    { action: 'navigate', type: 'goto', path: 'login.html' },
    { action: 'login', type: 'fill', selector: '#username', value: user },
    { action: 'login', type: 'fill', selector: '#password', value: pass },
    { action: 'login', type: 'click', selector: '#login-button' },
  ];
}

/** @deprecated Prefer buildDefaultDemoJourneySteps() so credentials stay current. */
export const DEFAULT_DEMO_JOURNEY_STEPS: JourneyStep[] = buildDefaultDemoJourneySteps();

export function resolveNavigationUrl(
  fixtureDir: string,
  path: string,
  targetBaseUrl?: string,
): string {
  const base = targetBaseUrl ?? process.env.AUDIT_TARGET_BASE_URL;
  if (base) {
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return new URL(path, normalized).href;
  }
  return pathToFileURL(join(fixtureDir, path)).href;
}
