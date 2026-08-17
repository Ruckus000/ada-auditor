'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiscoveredPage, DiscoveryError, DiscoveryTruncation } from '../../../../domain/discovery';
import {
  describeDepth,
  describeDiscoveryFailure,
  describeErrorTotal,
  describeJourneyCreationFailure,
  describeTruncation,
} from '../../lib/discovery-copy';
import { FONT, T } from '../../lib/tokens';

/**
 * Pick a journey's pages off a list, instead of typing a step for each one.
 *
 * Creating a journey was API work: a bearer POST naming a target URL and every
 * step, which in practice meant an operator opened the client's site in one tab
 * and hand-copied paths into a JSON body in another. `JourneyStepsEditor` fixed
 * *correcting* a journey and left creating one where it was, so the empty state
 * on this screen told people to go and use curl.
 *
 * Always visible, directly under the Journeys heading, rather than behind a
 * disclosure. The step editor hides because there is one per row and twenty
 * open forms is chaos; there is exactly one of these and it is now the primary
 * way a journey gets made. Being visible also earns the panel's idle state axe
 * coverage from the existing route sweep, with no test to register.
 *
 * **What it does not do.** `AUTHORABLE_ACTIONS`, the page cap a run enforces,
 * and what a step may do in which environment all stay where they are. The
 * selection warning below is advice, not a limit: `AUDITOR_MAX_PAGES_PER_RUN`
 * is enforced in the runner, which truncates loudly and logs it. Re-enforcing
 * it here would put one rule in two places and invalidate stored journeys the
 * day somebody lowered it.
 */

/**
 * When the panel starts saying "that is a lot of pages".
 *
 * `deployment-config.ts` defaults `AUDITOR_MAX_PAGES_PER_RUN` to 20, and a
 * client component cannot read the deployment's actual value — which is
 * exactly why this is worded as roughly-how-many rather than as a rule. If it
 * were a rule, a panel holding a stale copy of the number would refuse
 * selections a run would happily have walked.
 */
const SOFT_PAGE_ADVICE = 20;

type DiscoveryResponse = {
  pages?: DiscoveredPage[];
  errors?: DiscoveryError[];
  truncated?: DiscoveryTruncation;
  errorsOmitted?: number;
  error?: string;
  host?: string;
};

/**
 * A crawl's answer, plus the address it was an answer *about*.
 *
 * `origin` is captured here, when the result lands, and not read back off the
 * address box when the journey is saved. The operator may well have typed the
 * next site into that box while reading this list, and a journey whose steps
 * come from one site and whose target URL comes from another is a run that
 * walks nothing.
 */
type Found = {
  origin: string;
  pages: DiscoveredPage[];
  errors: DiscoveryError[];
  truncated?: DiscoveryTruncation;
  errorsOmitted: number;
};

/** The part of a discovered URL a `goto` step carries. */
function pathOf(url: string, origin: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    // A URL this could not parse cannot have come from the crawler, which
    // built every one of them with `new URL`. Falling back to the whole string
    // keeps the row readable rather than blanking a checkbox's label.
    return url.startsWith(origin) ? url.slice(origin.length) || '/' : url;
  }
}

const inputStyle = {
  fontFamily: FONT.mono,
  fontSize: 12,
  padding: '6px 9px',
  borderRadius: 7,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  minWidth: 0,
} as const;

const buttonStyle = {
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  cursor: 'pointer',
} as const;

const noteStyle = {
  margin: 0,
  fontFamily: FONT.sans,
  fontSize: 12.5,
  color: T.inkMuted,
} as const;

const statusStyle = {
  margin: 0,
  fontFamily: FONT.sans,
  fontSize: 12.5,
  color: T.inkMuted,
} as const;

function disabledStyle(disabled: boolean) {
  return disabled
    ? { background: T.surfaceSunk, color: T.inkMuted, cursor: 'default' as const }
    : {};
}

export function DiscoverPages({ clientId }: { clientId: string }) {
  const router = useRouter();
  const fieldPrefix = useId();
  const [targetUrl, setTargetUrl] = useState('');
  const [name, setName] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [crawling, setCrawling] = useState(false);
  const [creating, setCreating] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const headingId = `${fieldPrefix}-heading`;
  const urlId = `${fieldPrefix}-url`;
  const urlNoteId = `${fieldPrefix}-url-note`;
  const urlErrorId = `${fieldPrefix}-url-error`;
  const nameId = `${fieldPrefix}-name`;
  const nameNoteId = `${fieldPrefix}-name-note`;
  const nameErrorId = `${fieldPrefix}-name-error`;
  const errorsLabelId = `${fieldPrefix}-errors`;

  async function discover() {
    setCrawling(true);
    setCrawlError(null);
    setCreateError(null);
    setCreated(null);

    try {
      const response = await fetch('/api/platform/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetUrl: targetUrl.trim() }),
      });

      const payload = (await response.json().catch(() => null)) as DiscoveryResponse | null;

      if (!response.ok) {
        // `host` is passed straight through as structured data: the copy
        // module decides whether to name it and how far to clip it, because
        // that value came from somebody else's redirect.
        setCrawlError(
          describeDiscoveryFailure(payload?.error ?? `http_${response.status}`, {
            ...(payload?.host ? { host: payload.host } : {}),
          }),
        );
        return;
      }

      const pages = payload?.pages ?? [];
      setFound({
        // From the address that produced *this* result. `new URL` cannot throw
        // on it: the route parsed the same string before crawling anything.
        origin: new URL(targetUrl.trim()).origin,
        pages,
        errors: payload?.errors ?? [],
        ...(payload?.truncated ? { truncated: payload.truncated } : {}),
        errorsOmitted: payload?.errorsOmitted ?? 0,
      });
      // Nothing pre-ticked. A crawl of forty pages pre-selected is a journey
      // an operator has to talk *out* of pages, and the run cap makes that the
      // wrong default.
      setSelected(new Set());
    } catch {
      setCrawlError('Could not reach the server.');
    } finally {
      setCrawling(false);
    }
  }

  /**
   * The steps, in the order the crawl found the pages.
   *
   * Filtered out of `pages`, never spread out of `selected`. A `Set` iterates
   * in insertion order, which here is *tick* order — so a journey built from
   * it could open on a leaf page the operator happened to click first, and
   * every later step would be a navigation from somewhere unexpected.
   */
  const chosen = found ? found.pages.filter((page) => selected.has(page.url)) : [];

  async function create() {
    if (!found || chosen.length === 0 || name.trim() === '') return;

    setCreating(true);
    setCreateError(null);
    setCreated(null);

    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          targetUrl: found.origin,
          steps: chosen.map((page) => ({
            action: 'navigate',
            type: 'goto',
            path: pathOf(page.url, found.origin),
          })),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setCreateError(
          describeJourneyCreationFailure(payload?.error ?? `http_${response.status}`),
        );
        return;
      }

      // Cleared only on success, so a failed create leaves the whole selection
      // where it was and the operator retries rather than re-crawls.
      setCreated(name.trim());
      setName('');
      setSelected(new Set());
      router.refresh();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  function toggle(url: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  }

  /**
   * Crawl order within each depth, so `describeDepth` is said once per group
   * rather than repeated into every row's accessible name.
   *
   * Each row keeps its index in the whole list, because that is what makes a
   * checkbox's `id` unique. Two pages can share a title and — across a query
   * string the crawl deliberately keys on — nearly share a path, so neither is
   * usable as an id on its own.
   */
  const groups: Array<{ depth: number; rows: Array<{ page: DiscoveredPage; index: number }> }> = [];
  (found?.pages ?? []).forEach((page, index) => {
    const group = groups.find((one) => one.depth === page.depth);
    if (group) group.rows.push({ page, index });
    else groups.push({ depth: page.depth, rows: [{ page, index }] });
  });
  groups.sort((a, b) => a.depth - b.depth);

  const truncation = describeTruncation(found?.truncated);
  const nothingToCreate = chosen.length === 0 || name.trim() === '';
  const canCrawl = targetUrl.trim() !== '' && !crawling;

  return (
    <section
      aria-labelledby={headingId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        borderRadius: 10,
        border: `1px solid ${T.rule}`,
        background: T.surfaceSunk,
      }}
    >
      <h3 id={headingId} style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
        Discover pages
      </h3>

      <p style={noteStyle}>
        Give a site address and this walks it, then turn the pages you pick into a journey that
        visits each one.
      </p>

      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 260px' }}>
          {/*
            A real visible label, not a placeholder and not an `aria-label`.
            The axe sweep over these screens runs at zero, and a label that
            disappears the moment somebody types is the cheapest way to lose
            that.
          */}
          <label htmlFor={urlId} style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
            Site address
          </label>
          <input
            id={urlId}
            type="url"
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            // A box you type an address into and press Enter in is the box
            // everyone expects. There is no `<form>` here to do it — the panel
            // has two independent submits and one form around both would fire
            // the wrong one.
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canCrawl) void discover();
            }}
            aria-invalid={crawlError ? true : undefined}
            aria-describedby={[urlNoteId, crawlError ? urlErrorId : null].filter(Boolean).join(' ')}
            style={{ ...inputStyle, width: '100%' }}
          />
        </span>

        <button
          type="button"
          onClick={discover}
          disabled={!canCrawl}
          style={{ ...buttonStyle, ...disabledStyle(!canCrawl) }}
        >
          {crawling ? 'Looking…' : 'Find pages'}
        </button>
      </span>

      <p id={urlNoteId} style={noteStyle}>
        The whole address, starting <code>https://</code>. A crawl walks up to three clicks from
        there and takes about a minute.
      </p>

      {/*
        Why the button is dead, said out loud. A disabled control cannot take
        focus, so without this a screen reader user reaches the end of the row
        and finds nothing that explains it.
      */}
      {targetUrl.trim() === '' ? <p style={noteStyle}>Type a site address to search it.</p> : null}

      {crawlError ? (
        <p
          id={urlErrorId}
          role="alert"
          style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}
        >
          {crawlError}
        </p>
      ) : null}

      {/*
        Rendered always, holding an empty string when idle.
        `run-journey-button.tsx` records the reason: a live region mounted in
        the same tick as its text is frequently not announced at all, so a
        region that only appears when there is something to say says nothing.
      */}
      <p role="status" style={statusStyle}>
        {crawling
          ? 'Looking for pages…'
          : found
            ? `Found ${found.pages.length === 1 ? '1 page' : `${found.pages.length} pages`}.`
            : ''}
      </p>

      {truncation ? <p style={noteStyle}>{truncation}</p> : null}

      {found && found.pages.length > 0 ? (
        <>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setSelected(new Set(found.pages.map((page) => page.url)))}
              style={buttonStyle}
            >
              Select every page
            </button>
            <button type="button" onClick={() => setSelected(new Set())} style={buttonStyle}>
              Clear the selection
            </button>
          </span>

          {/*
            No scroll container, deliberately. A pane that scrolls its own
            content is a keyboard trap unless it is focusable, and making it
            focusable puts a tab stop in front of every checkbox — axe's
            `scrollable-region-focusable` names the first and this screen would
            pay for the second forty times. The two buttons above are what make
            a long list cheap.
          */}
          {groups.map((group) => (
            <fieldset
              key={group.depth}
              style={{
                margin: 0,
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${T.rule}`,
                background: T.surface,
              }}
            >
              {/*
                Depth said once, as prose, for the whole group. Repeated into
                every checkbox it would be forty announcements of a number that
                describes the group and not the page.
              */}
              <legend style={{ fontFamily: FONT.sans, fontSize: 12, fontWeight: 650 }}>
                {describeDepth(group.depth)} ·{' '}
                {group.rows.length === 1 ? '1 page' : `${group.rows.length} pages`}
              </legend>

              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {group.rows.map(({ page, index }) => {
                  const boxId = `${fieldPrefix}-page-${index}`;
                  const path = pathOf(page.url, found.origin);

                  return (
                    <li key={page.url} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <input
                        id={boxId}
                        type="checkbox"
                        checked={selected.has(page.url)}
                        onChange={() => toggle(page.url)}
                      />
                      <label
                        htmlFor={boxId}
                        style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.ink }}
                      >
                        {page.title || path}{' '}
                        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                          {path}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </>
      ) : null}

      {found && found.errors.length > 0 ? (
        <>
          <p id={errorsLabelId} style={noteStyle}>
            {describeErrorTotal(found.errors.length, found.errorsOmitted)}
          </p>
          <ul
            aria-labelledby={errorsLabelId}
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            {found.errors.map((failure) => (
              /*
                The URL *and* the message. The crawler's own comment argues it:
                `/offsite-redirect.html` alone reads as "your own page is not in
                your allowed domains", which is nonsense, and the message alone
                names nothing the operator can find in their markup.
              */
              <li
                key={`${failure.url} ${failure.message}`}
                style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}
              >
                {failure.url} — {failure.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {found && found.pages.length > 0 ? (
        <>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 200px' }}>
              <label
                htmlFor={nameId}
                style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}
              >
                Journey name
              </label>
              <input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={createError ? true : undefined}
                aria-describedby={[nameNoteId, createError ? nameErrorId : null]
                  .filter(Boolean)
                  .join(' ')}
                style={{ ...inputStyle, fontFamily: FONT.sans, width: '100%' }}
              />
            </span>

            <button
              type="button"
              onClick={create}
              disabled={creating || nothingToCreate}
              style={{ ...buttonStyle, ...disabledStyle(creating || nothingToCreate) }}
            >
              {creating ? 'Creating…' : 'Create journey'}
            </button>
          </span>

          <p id={nameNoteId} style={noteStyle}>
            {chosen.length === 0
              ? `Nothing picked yet. The journey will visit ${found.origin} and go to each page you tick, in the order they were found.`
              : `${chosen.length === 1 ? '1 page' : `${chosen.length} pages`} picked. The journey will visit ${found.origin} and go to each, in the order they were found.`}
          </p>

          {nothingToCreate ? (
            <p style={noteStyle}>
              {chosen.length === 0
                ? 'Tick at least one page before creating a journey.'
                : 'Give the journey a name before creating it.'}
            </p>
          ) : null}

          {chosen.length > SOFT_PAGE_ADVICE ? (
            /*
              Advice, not a limit. The real cap is `AUDITOR_MAX_PAGES_PER_RUN`
              in the runner, which truncates loudly and logs it; enforcing it
              here as well would put one rule in two places, and would
              invalidate every stored journey the day somebody lowered it.
            */
            <p style={{ ...noteStyle, color: T.caution }}>
              That is {chosen.length} pages. A run audits about {SOFT_PAGE_ADVICE} by default and
              stops there, so the rest would not be looked at — this is worth splitting into more
              than one journey.
            </p>
          ) : null}

          {createError ? (
            <p
              id={nameErrorId}
              role="alert"
              style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}
            >
              {createError}
            </p>
          ) : null}
        </>
      ) : null}

      {/* Always rendered, for the same reason as the crawl's region above. */}
      <p role="status" style={statusStyle}>
        {created ? `Created ${created}. It is in the list below.` : ''}
      </p>
    </section>
  );
}
