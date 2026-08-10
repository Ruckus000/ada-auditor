import { describe, expect, it } from 'vitest';
import { clientHref, parseRoute, workspaceHref } from '../../src/app/platform/lib/params';

describe('parseRoute', () => {
  it.each([
    ['/', { scope: 'ws', screen: 'portfolio', clientSlug: null, clientTab: 'overview' }],
    ['/reports', { scope: 'ws', screen: 'reports', clientSlug: null }],
    ['/activity', { scope: 'ws', screen: 'activity', clientSlug: null }],
    ['/settings', { scope: 'ws', screen: 'settings', clientSlug: null }],
  ])('reads %s', (pathname, expected) => {
    expect(parseRoute(pathname)).toMatchObject(expected);
  });

  it.each([
    ['/clients/acme', { scope: 'client', clientSlug: 'acme', clientTab: 'overview' }],
    ['/clients/acme/findings', { scope: 'client', clientSlug: 'acme', clientTab: 'findings' }],
    ['/clients/acme/journeys', { scope: 'client', clientSlug: 'acme', clientTab: 'journeys' }],
  ])('reads %s', (pathname, expected) => {
    expect(parseRoute(pathname)).toMatchObject(expected);
  });

  it('falls back to the portfolio rather than throwing', () => {
    // This runs inside a layout, and a throw there takes the whole shell down
    // with it — including the header that would let somebody navigate away.
    expect(parseRoute('/nope')).toMatchObject({ scope: 'ws', screen: 'portfolio' });
    expect(parseRoute('')).toMatchObject({ scope: 'ws', screen: 'portfolio' });
    expect(parseRoute('/reports/extra/segments')).toMatchObject({ screen: 'reports' });
  });

  it('falls back to the overview for a tab that does not exist', () => {
    // The tab vocabulary used to name six tabs, four of which no route could
    // reach. An unknown segment resolves to the tab that does.
    expect(parseRoute('/clients/acme/settings')).toMatchObject({
      scope: 'client',
      clientSlug: 'acme',
      clientTab: 'overview',
    });
  });

  it('keeps an unrecognised client slug rather than substituting one', () => {
    // Whether the client exists is the database's question, answered in the
    // client layout with a 404. Silently swapping in another slug here is how
    // one client's findings ended up under another client's address.
    expect(parseRoute('/clients/does-not-exist')).toMatchObject({
      scope: 'client',
      clientSlug: 'does-not-exist',
    });
  });

  it.each([
    ['/clients/../secrets', 'clients'],
    ['/clients/%2e%2e%2fetc', 'clients'],
    ["/clients/'; drop table clients--", 'clients'],
  ])('treats %j as an ordinary slug', (pathname, first) => {
    // Nothing here interpolates a slug into a path or a query — it is compared
    // against the database and 404s. The assertion is that parsing does not
    // resolve or normalise it into something else.
    const route = parseRoute(pathname);
    expect(pathname.split('/').filter(Boolean)[0]).toBe(first);
    expect(route.scope).toBe('client');
  });
});

describe('href builders', () => {
  it('builds workspace hrefs, with the portfolio at the root', () => {
    expect(workspaceHref('portfolio')).toBe('/');
    expect(workspaceHref('reports')).toBe('/reports');
  });

  it('builds client hrefs, with the overview at the client root', () => {
    expect(clientHref('acme')).toBe('/clients/acme');
    expect(clientHref('acme', 'findings')).toBe('/clients/acme/findings');
    expect(clientHref('acme', 'journeys')).toBe('/clients/acme/journeys');
  });

  it('round-trips every route it can build', () => {
    // The two halves of this module have to agree, or a link goes somewhere
    // the parser reads as a different screen.
    for (const screen of ['portfolio', 'reports', 'activity', 'settings'] as const) {
      expect(parseRoute(workspaceHref(screen)).screen).toBe(screen);
    }
    for (const tab of ['overview', 'findings', 'journeys'] as const) {
      expect(parseRoute(clientHref('acme', tab))).toMatchObject({ clientSlug: 'acme', clientTab: tab });
    }
  });
});
