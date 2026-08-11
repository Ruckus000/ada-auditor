import { resolve, sep } from 'node:path';
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
 * local fixtures and the path becomes a `file://` URL. A remote result still
 * has to go through the target-url guard — this function does not do that.
 *
 * The fixture branch does its own containment check, because nothing else
 * will. `path` arrives from the request body, `join` resolves `..` happily,
 * and the remote guard is skipped entirely when there is no `targetUrl` — so
 * `{"type":"goto","path":"../../../../etc/passwd"}` on a fixture run was an
 * arbitrary local file read, rendered into the DOM snapshot and served back
 * through the artifacts route. `audit-run-handler` already refuses to take
 * `fixtureDir` over HTTP for exactly this reason, calling it a local file read
 * primitive; `path` was the same primitive one field over.
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

  // The same containment shape `resolveArtifactPrefix` uses on `stepId`.
  const root = resolve(fixtureDir);
  const target = resolve(root, path);

  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('Navigation path must not escape the fixture directory.');
  }

  return pathToFileURL(target).href;
}
