import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { JourneyStep } from './types';

/**
 * The built-in demo journey, used by the fixture app, the chaos scenarios and
 * the console's practice runs.
 *
 * Its credentials are fixture credentials — they unlock a local HTML file, not
 * anyone's account — so they are literals here rather than a `credentialRef`.
 * Real client journeys carry a reference and the secret is resolved
 * server-side; see `credentials.ts`.
 */

export const DEMO_USER = 'auditor';
export const DEMO_PASS = 'demo-pass';

export function buildDefaultDemoJourneySteps(): JourneyStep[] {
  return [
    { action: 'navigate', type: 'goto', path: 'login.html' },
    { action: 'login', type: 'fill', selector: '#username', value: DEMO_USER },
    { action: 'login', type: 'fill', selector: '#password', value: DEMO_PASS },
    { action: 'login', type: 'click', selector: '#login-button' },
  ];
}

/**
 * Resolves a step's path against the run's target.
 *
 * With a target origin the path joins onto it; without one the run is against
 * local fixtures and the path becomes a `file://` URL. The caller is
 * responsible for putting the result through the target-url guard — this
 * function only builds the string.
 */
export function resolveNavigationUrl(
  fixtureDir: string,
  path: string,
  targetUrl?: string,
): string {
  if (targetUrl) {
    const normalized = targetUrl.endsWith('/') ? targetUrl : `${targetUrl}/`;
    return new URL(path, normalized).href;
  }

  return pathToFileURL(join(fixtureDir, path)).href;
}
