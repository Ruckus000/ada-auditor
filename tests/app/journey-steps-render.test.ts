import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClientDetail } from '../../src/services/client-detail';

/**
 * `JourneySchedule` and `RunJourneyButton` are client components holding
 * `useState`, and both render on every journey row. Stubbed so the server
 * renderer can reach the step list; neither carries any of its behaviour.
 */
vi.mock('../../src/app/platform/components/client/journey-schedule', () => ({
  JourneySchedule: () => null,
}));
vi.mock('../../src/app/platform/components/client/run-journey-button', () => ({
  RunJourneyButton: () => null,
}));

const { ClientJourneys } = await import(
  '../../src/app/platform/components/client/client-journeys'
);
const { toStepViews } = await import('../../src/domain/journey-step');

/**
 * The journeys screen, showing what a journey actually does.
 *
 * It showed a step *count*. An operator could not tell whether a journey
 * logged in and reached a dashboard or fetched one page five times — and that
 * invisibility is why no static rule can be trusted to police what a step
 * does. `{action:'activate', type:'click', selector:'#delete-account'}` passes
 * every check in `authoredStepSchema`; a person reading the list is the
 * defence.
 */
function detailWith(steps: unknown[]): ClientDetail {
  return {
    id: 'acme',
    name: 'Acme',
    journeys: [
      {
        id: 'login',
        name: 'Login',
        targetUrl: 'https://acme.test',
        // The real conversion, not a hand-built view: this test is about what
        // reaches the screen, and substituting a convenient shape here would
        // prove nothing about the path that actually runs.
        steps: toStepViews(steps),
        runRefusal: null,
        schedule: 'off',
        lastRun: null,
      },
    ],
  } as unknown as ClientDetail;
}

function render(steps: unknown[]): string {
  return renderToStaticMarkup(createElement(ClientJourneys, { detail: detailWith(steps) }));
}

describe('the journeys screen', () => {
  it('shows what each step does, in order', () => {
    const html = render([
      { action: 'navigate', type: 'goto', path: 'login.html' },
      { action: 'login', type: 'fill', selector: '#u', credentialRef: 'acme', field: 'user' },
      { action: 'inspect', type: 'expect', urlIncludes: '/dashboard' },
    ]);

    expect(html).toContain('login.html');
    expect(html).toContain('#u');
    expect(html).toContain('url contains /dashboard');
    // The credential's name, which is not a secret — naming it is the point of
    // `credentialRef` — and the field, so a transposed login is visible.
    expect(html).toContain('acme');
    expect(html).toContain('user');
  });

  /**
   * The rule this screen must never break.
   *
   * `authoredStepSchema` refuses a `login` fill carrying a literal, but only
   * for new writes. Rows stored before it exist and some hold a real password.
   * Rendering one would move a secret from a database column onto a screen —
   * and this screen is behind the operator gate, not the client's, but that is
   * not a reason to put it there.
   */
  it('never prints a literal value, only that there is one', () => {
    const html = render([
      { action: 'login', type: 'fill', selector: '#p', value: 'hunter2' },
      { action: 'search', type: 'fill', selector: '#q', value: 'shoes' },
    ]);

    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('shoes');
    expect(html).toContain('types a literal value');
  });

  it('calls an unrunnable step what it is', () => {
    // The write route accepted anything until `authoredStepSchema`, so these
    // are out there. They cannot run — both the run and schedule routes refuse
    // them — and the operator needs to know before a schedule fires, not after.
    const html = render([{ banana: 1 }]);

    expect(html).toContain('not a runnable step');
  });

  it('renders a journey with no steps without inventing a list', () => {
    const html = render([]);

    expect(html).not.toContain('not a runnable step');
    expect(html).toContain('Login');
  });
});
