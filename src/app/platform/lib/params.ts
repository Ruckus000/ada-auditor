/**
 * The URL is the state.
 *
 * The prototype navigated with `useState` — `state.client` was an array index,
 * the address bar never changed, and nothing was linkable. Worse, the sort and
 * owner menus wrote to `state.picks`, which was read by exactly one thing: the
 * menu's own label. Six controls that looked like filters and filtered nothing.
 *
 * Everything here is pure and string-in/string-out, so the routing rules are
 * testable without a browser, a router, or a rendered component.
 */

export type Scope = 'ws' | 'client';

export type WorkspaceScreen = 'portfolio' | 'reports' | 'activity' | 'settings';

export type ClientTab =
  | 'overview'
  | 'journeys'
  | 'findings'
  | 'finding'
  | 'reports'
  | 'activity'
  | 'settings';

/** Mirrors `FindingFilter` in derive.ts, which dies with the fixtures. */
const FINDING_FILTERS = ['all', 'must', 'should', 'nice', 'dismissed'] as const;
export type FindingFilter = (typeof FINDING_FILTERS)[number];

const AUDIENCES = ['legal', 'dev', 'exec'] as const;
export type Audience = (typeof AUDIENCES)[number];

const SETTINGS_TABS = [
  'people',
  'tools',
  'reportDefaults',
  'display',
  'scanning',
  'standard',
  'schedule',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/**
 * The dropdown menus.
 *
 * These carry the chosen *label* rather than an enum, because today that is
 * all they are: the prototype's menus wrote to `state.picks`, which was read
 * by exactly one thing — the menu's own label. Putting the label in the URL is
 * the honest first step: the choice survives a reload and a shared link, and
 * it stops being a control that silently does nothing. Giving them query
 * semantics is the job of the slice that makes the data real, and at that
 * point these become enumerated like the ones above.
 */
export const MENU_KEYS = ['sort', 'owner', 'people', 'range', 'pages', 'status'] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

/**
 * Anything arriving from a URL is attacker-controlled, so every reader falls
 * back to a known value rather than passing an unrecognised string onward.
 * `?filter=' or 1=1--` has to become `all`, not reach a query.
 */
function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | undefined | null,
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A URL-safe, human-legible id for a client. */
export function clientSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type PlatformRoute = {
  scope: Scope;
  screen: WorkspaceScreen;
  clientTab: ClientTab;
  clientSlug: string | null;
  /** Which finding the detail screen is showing. */
  findIndex: number;
  /** Which report the builder is open on, or null for the library. */
  reportOpen: number | null;
};

const CLIENT_TABS: Record<string, ClientTab> = {
  journeys: 'journeys',
  findings: 'findings',
  reports: 'reports',
  activity: 'activity',
  settings: 'settings',
};

/**
 * Reads the route out of a pathname.
 *
 * Deliberately total: an unknown path resolves to the portfolio rather than
 * throwing, because a 404 inside a layout takes the whole shell down with it.
 */
export function parseRoute(pathname: string): PlatformRoute {
  const segments = pathname.split('/').filter(Boolean);

  const base: PlatformRoute = {
    scope: 'ws',
    screen: 'portfolio',
    clientTab: 'overview',
    clientSlug: null,
    findIndex: 0,
    reportOpen: null,
  };

  if (segments.length === 0) {
    return base;
  }

  if (segments[0] === 'clients' && segments[1]) {
    const clientSlug = segments[1];
    const tabSegment = segments[2];

    if (!tabSegment) {
      return { ...base, scope: 'client', clientSlug };
    }

    const clientTab = CLIENT_TABS[tabSegment];
    if (!clientTab) {
      return { ...base, scope: 'client', clientSlug };
    }

    // `/findings/3` is the detail screen — a distinct tab in the prototype's
    // vocabulary, and the reason `finding` is not reachable as a path segment
    // of its own.
    if (clientTab === 'findings' && segments[3] !== undefined) {
      return {
        ...base,
        scope: 'client',
        clientSlug,
        clientTab: 'finding',
        findIndex: Math.max(0, Number.parseInt(segments[3], 10) || 0),
      };
    }

    if (clientTab === 'reports' && segments[3] !== undefined) {
      return {
        ...base,
        scope: 'client',
        clientSlug,
        clientTab: 'reports',
        reportOpen: Math.max(0, Number.parseInt(segments[3], 10) || 0),
      };
    }

    return { ...base, scope: 'client', clientSlug, clientTab };
  }

  const screen = oneOf<WorkspaceScreen>(
    ['portfolio', 'reports', 'activity', 'settings'],
    segments[0],
    'portfolio',
  );

  if (screen === 'reports' && segments[1] !== undefined) {
    return {
      ...base,
      screen,
      reportOpen: Math.max(0, Number.parseInt(segments[1], 10) || 0),
    };
  }

  return { ...base, screen };
}

/** Minimal read interface, so callers can pass `URLSearchParams` or a plain map. */
export type ReadableParams = { get(key: string): string | null };

export type PlatformSearch = {
  filter: FindingFilter;
  audience: Audience;
  settingsTab: SettingsTab;
};

export function parseSearch(params: ReadableParams): PlatformSearch {
  return {
    filter: oneOf(FINDING_FILTERS, params.get('filter'), 'all'),
    audience: oneOf(AUDIENCES, params.get('audience'), 'legal'),
    settingsTab: oneOf(SETTINGS_TABS, params.get('tab'), 'people'),
  };
}

/** What a menu is currently set to, or the control's own default label. */
export function menuValue(
  params: ReadableParams,
  key: MenuKey,
  fallback: string,
): string {
  return params.get(key) ?? fallback;
}

const SEARCH_DEFAULTS: Record<string, string> = {
  filter: 'all',
  audience: 'legal',
  tab: 'people',
};

/** Drops defaults, so a URL only carries what the operator actually chose. */
export function searchToQuery(search: Partial<PlatformSearch>): string {
  const byKey: Record<string, string | undefined> = {
    filter: search.filter,
    audience: search.audience,
    tab: search.settingsTab,
  };

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(byKey)) {
    if (value !== undefined && value !== SEARCH_DEFAULTS[key]) {
      query.set(key, value);
    }
  }

  const serialised = query.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * The current URL with one menu changed.
 *
 * Preserves every other parameter: changing the sort must not silently reset
 * the severity filter, which is exactly the kind of thing hand-rolled
 * `pushState` gets wrong.
 */
export function withMenu(
  pathname: string,
  params: ReadableParams & { entries?: () => IterableIterator<[string, string]> },
  key: MenuKey,
  value: string,
  fallback: string,
): string {
  const query = new URLSearchParams();
  for (const existing of params.entries?.() ?? []) {
    query.set(existing[0], existing[1]);
  }

  if (value === fallback) {
    query.delete(key);
  } else {
    query.set(key, value);
  }

  const serialised = query.toString();
  return serialised ? `${pathname}?${serialised}` : pathname;
}

export function workspaceHref(
  screen: WorkspaceScreen,
  search: Partial<PlatformSearch> = {},
): string {
  const path = screen === 'portfolio' ? '/' : `/${screen}`;
  return `${path}${searchToQuery(search)}`;
}

export function clientHref(
  slug: string,
  tab: ClientTab = 'overview',
  search: Partial<PlatformSearch> = {},
): string {
  const path =
    tab === 'overview'
      ? `/clients/${slug}`
      : tab === 'finding'
        ? `/clients/${slug}/findings`
        : `/clients/${slug}/${tab}`;

  return `${path}${searchToQuery(search)}`;
}

export function findingHref(
  slug: string,
  index: number,
  search: Partial<PlatformSearch> = {},
): string {
  return `/clients/${slug}/findings/${index}${searchToQuery(search)}`;
}

export function reportHref(
  slug: string | null,
  index: number,
  search: Partial<PlatformSearch> = {},
): string {
  const path = slug ? `/clients/${slug}/reports/${index}` : `/reports/${index}`;
  return `${path}${searchToQuery(search)}`;
}
