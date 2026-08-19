/**
 * The route vocabulary, as pure functions.
 *
 * The prototype navigated with `useState`, so nothing was linkable: no deep
 * links, no back button, no way to send a colleague the screen you were
 * looking at. This module is where the URL became the source of truth for
 * where you are — and it is deliberately free of React, so the whole route
 * grammar is testable without a browser, a router, or a rendered component.
 *
 * It has shrunk twice. It once carried a filter union, an audience union, a
 * settings-tab union and six menu keys, all written into query strings by
 * fixture screens that have since gone. What is left is what a path can
 * actually reach — the rule being that a screen name no route can produce is a
 * screen nobody can open, which is how `states` and `coverage` survived as
 * dead vocabulary long after they stopped existing.
 */

export type Scope = 'ws' | 'client';

export type WorkspaceScreen = 'portfolio' | 'reports' | 'activity' | 'settings';

export type ClientTab = 'overview' | 'findings' | 'journeys';

export type PlatformRoute = {
  scope: Scope;
  screen: WorkspaceScreen;
  clientTab: ClientTab;
  clientSlug: string | null;
};

const WORKSPACE_SCREENS: Record<string, WorkspaceScreen> = {
  reports: 'reports',
  activity: 'activity',
  settings: 'settings',
};

const CLIENT_TABS: Record<string, ClientTab> = {
  findings: 'findings',
  journeys: 'journeys',
};

/**
 * Reads the route out of a pathname.
 *
 * Deliberately total: an unknown path resolves to the portfolio rather than
 * throwing, because this runs inside a layout and a throw there takes the
 * whole shell down. Refusing an unknown *client* is a different matter and
 * happens in the client layout, against the database.
 */
export function parseRoute(pathname: string): PlatformRoute {
  const segments = pathname.split('/').filter(Boolean);

  const base: PlatformRoute = {
    scope: 'ws',
    screen: 'portfolio',
    clientTab: 'overview',
    clientSlug: null,
  };

  if (segments.length === 0) {
    return base;
  }

  if (segments[0] === 'clients' && segments[1] === 'new') {
    // Not a client: `scope: 'client'` keeps the header from highlighting a
    // workspace tab, and `clientSlug` stays null because there is no record
    // to name yet.
    return { ...base, scope: 'client' };
  }

  if (segments[0] === 'clients' && segments[1]) {
    const clientSlug = segments[1];
    const tab = segments[2] ? CLIENT_TABS[segments[2]] : 'overview';

    return { ...base, scope: 'client', clientSlug, clientTab: tab ?? 'overview' };
  }

  return { ...base, screen: WORKSPACE_SCREENS[segments[0]] ?? 'portfolio' };
}

export function workspaceHref(screen: WorkspaceScreen): string {
  return screen === 'portfolio' ? '/' : `/${screen}`;
}

export function clientHref(slug: string, tab: ClientTab = 'overview'): string {
  return tab === 'overview' ? `/clients/${slug}` : `/clients/${slug}/${tab}`;
}
