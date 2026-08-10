import { describe, expect, it } from 'vitest';
import {
  clientHref,
  clientSlug,
  findingHref,
  parseRoute,
  parseSearch,
  menuValue,
  reportHref,
  searchToQuery,
  withMenu,
  workspaceHref,
} from '../../src/app/platform/lib/params';

/**
 * These rules used to live in a `useState` object where nothing could reach
 * them. Pure here, so the routing contract is covered by the 2-second suite
 * rather than by clicking around.
 */

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('clientSlug', () => {
  it.each([
    ['Northwind Health', 'northwind-health'],
    ['Acme Outfitters', 'acme-outfitters'],
    ['Portland Transit', 'portland-transit'],
    ['Halcyon & Co.', 'halcyon-co'],
  ])('turns %j into %j', (name, slug) => {
    expect(clientSlug(name)).toBe(slug);
  });

  it('leaves no leading or trailing separators', () => {
    expect(clientSlug('  Spaced Out!  ')).toBe('spaced-out');
  });
});

describe('parseRoute', () => {
  it('reads the portfolio from the root', () => {
    expect(parseRoute('/')).toMatchObject({ scope: 'ws', screen: 'portfolio' });
  });

  it('reads a workspace screen', () => {
    expect(parseRoute('/activity')).toMatchObject({ scope: 'ws', screen: 'activity' });
  });

  it('reads a client overview', () => {
    expect(parseRoute('/clients/acme-outfitters')).toMatchObject({
      scope: 'client',
      clientSlug: 'acme-outfitters',
      clientTab: 'overview',
    });
  });

  it.each(['journeys', 'findings', 'reports', 'activity', 'settings'])(
    'reads the %s tab',
    (tab) => {
      expect(parseRoute(`/clients/acme/${tab}`)).toMatchObject({
        scope: 'client',
        clientSlug: 'acme',
        clientTab: tab,
      });
    },
  );

  it('reads a single finding as the detail screen', () => {
    // The prototype called this a separate tab, and deep-linking one finding
    // is the whole reason the restructure is worth doing.
    expect(parseRoute('/clients/acme/findings/7')).toMatchObject({
      clientTab: 'finding',
      findIndex: 7,
    });
  });

  it('reads an open report builder', () => {
    expect(parseRoute('/clients/acme/reports/2')).toMatchObject({
      clientTab: 'reports',
      reportOpen: 2,
    });
    expect(parseRoute('/reports/2')).toMatchObject({ screen: 'reports', reportOpen: 2 });
  });

  it('leaves the report builder closed on the library route', () => {
    expect(parseRoute('/clients/acme/reports').reportOpen).toBeNull();
    expect(parseRoute('/reports').reportOpen).toBeNull();
  });

  it('falls back to the portfolio rather than throwing on an unknown path', () => {
    // A throw inside a layout takes the whole shell down, so this is total by
    // design.
    expect(parseRoute('/nope/nowhere')).toMatchObject({ scope: 'ws', screen: 'portfolio' });
  });

  it('ignores an unknown client tab rather than rendering nothing', () => {
    expect(parseRoute('/clients/acme/wat')).toMatchObject({
      scope: 'client',
      clientSlug: 'acme',
      clientTab: 'overview',
    });
  });

  it.each(['abc', '-4', ''])('clamps a non-numeric finding index %j to 0', (raw) => {
    expect(parseRoute(`/clients/acme/findings/${raw}`).findIndex).toBe(0);
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/clients/acme/findings/')).toMatchObject({ clientTab: 'findings' });
  });
});

describe('parseSearch', () => {
  it('reads the filters an operator chose', () => {
    const search = parseSearch(params('filter=must&audience=dev&tab=display'));

    expect(search).toMatchObject({
      filter: 'must',
      audience: 'dev',
      settingsTab: 'display',
    });
  });

  it('defaults everything that is absent', () => {
    expect(parseSearch(params(''))).toEqual({
      filter: 'all',
      audience: 'legal',
      settingsTab: 'people',
    });
  });

  it.each([
    ['filter', "' or 1=1--", 'filter', 'all'],
    ['audience', 'everyone', 'audience', 'legal'],
    ['tab', '../../etc/passwd', 'settingsTab', 'people'],
  ])('falls back rather than passing an unknown %s onward', (key, value, field, expected) => {
    // Everything here is attacker-controlled. An unrecognised value has to
    // become a known one before anything downstream sees it.
    const search = parseSearch(params(`${key}=${encodeURIComponent(value)}`));
    expect(search[field as keyof typeof search]).toBe(expected);
  });
});

describe('searchToQuery', () => {
  it('emits nothing when everything is at its default', () => {
    // A URL should carry what the operator chose, not the entire state.
    expect(searchToQuery({ filter: 'all', audience: 'legal' })).toBe('');
    expect(searchToQuery({})).toBe('');
  });

  it('emits only the values that differ', () => {
    expect(searchToQuery({ filter: 'must', audience: 'legal' })).toBe('?filter=must');
  });

  it('round-trips through parseSearch', () => {
    const chosen = { filter: 'dismissed', audience: 'exec', settingsTab: 'scanning' } as const;
    const reparsed = parseSearch(params(searchToQuery(chosen).slice(1)));

    expect(reparsed).toMatchObject(chosen);
  });
});

describe('href builders', () => {
  it('builds workspace links', () => {
    expect(workspaceHref('portfolio')).toBe('/');
    expect(workspaceHref('activity')).toBe('/activity');
    expect(workspaceHref('settings', { settingsTab: 'display' })).toBe('/settings?tab=display');
  });

  it('builds client links', () => {
    expect(clientHref('acme')).toBe('/clients/acme');
    expect(clientHref('acme', 'findings')).toBe('/clients/acme/findings');
    expect(clientHref('acme', 'findings', { filter: 'must' })).toBe(
      '/clients/acme/findings?filter=must',
    );
  });

  it('sends the finding detail tab back to the findings list', () => {
    // `finding` is a tab in the prototype's vocabulary but not a path of its
    // own — the list is the parent, and a bare `finding` href must not 404.
    expect(clientHref('acme', 'finding')).toBe('/clients/acme/findings');
  });

  it('builds finding and report links', () => {
    expect(findingHref('acme', 3)).toBe('/clients/acme/findings/3');
    expect(reportHref('acme', 1)).toBe('/clients/acme/reports/1');
    expect(reportHref(null, 1)).toBe('/reports/1');
  });

  it('round-trips every href back through parseRoute', () => {
    // The two halves have to agree, or a link goes somewhere the parser reads
    // as somewhere else.
    expect(parseRoute(clientHref('acme', 'journeys'))).toMatchObject({
      clientSlug: 'acme',
      clientTab: 'journeys',
    });
    expect(parseRoute(findingHref('acme', 4))).toMatchObject({
      clientTab: 'finding',
      findIndex: 4,
    });
    expect(parseRoute(reportHref('acme', 2))).toMatchObject({
      clientTab: 'reports',
      reportOpen: 2,
    });
    expect(parseRoute(workspaceHref('settings'))).toMatchObject({ screen: 'settings' });
  });
});

describe('menus', () => {
  it('falls back to the control\'s own label when unset', () => {
    expect(menuValue(params(''), 'sort', 'Sort: most urgent')).toBe('Sort: most urgent');
  });

  it('reads a chosen value', () => {
    expect(menuValue(params('sort=Name'), 'sort', 'Sort: most urgent')).toBe('Name');
  });

  it('keeps every other parameter when one menu changes', () => {
    // Changing the sort must not silently reset the severity filter. This is
    // exactly what hand-rolled pushState gets wrong.
    const href = withMenu(
      '/clients/acme/findings',
      params('filter=must&owner=MS'),
      'sort',
      'Name',
      'Sort: most urgent',
    );

    expect(href).toContain('filter=must');
    expect(href).toContain('owner=MS');
    expect(href).toContain('sort=Name');
  });

  it('drops the parameter when the default is chosen again', () => {
    const href = withMenu(
      '/clients/acme/findings',
      params('sort=Name&filter=must'),
      'sort',
      'Sort: most urgent',
      'Sort: most urgent',
    );

    expect(href).not.toContain('sort=');
    expect(href).toContain('filter=must');
  });

  it('returns a bare path when nothing is left to carry', () => {
    expect(withMenu('/', params('sort=Name'), 'sort', 'Default', 'Default')).toBe('/');
  });
});
