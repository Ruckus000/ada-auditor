'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type DiscoveredPage,
  type DiscoveryError,
  type DiscoveryTruncation,
  stepPathFor,
} from '../../../../domain/discovery';
import { MAX_STEP_TEXT, MAX_STEPS_PER_JOURNEY } from '../../../../domain/journey-step';
import { MAX_JOURNEY_NAME } from '../../../../domain/platform';
import {
  clipHost,
  describeDepth,
  describeDiscoveryFailure,
  describeErrorTotal,
  describeJourneyCreationFailure,
  describeTruncation,
} from '../../lib/discovery-copy';
import { inertWhen } from '../../lib/inert-button';
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
 * **Which caps this panel restates, and which it does not.** The line is not
 * "never repeat a rule" — it is *where the rule is decided*.
 *
 * Restated here, because they are write-time bounds on the very route this
 * panel posts to, and a screen that can only discover them by posting and
 * reading back `invalid_request_body` reports them as a mystery:
 * `MAX_JOURNEY_NAME` (120), `MAX_STEP_TEXT` (512 per path) and
 * `MAX_STEPS_PER_JOURNEY` (50 steps). Each is imported from the module that
 * declares it — `domain/platform` for the first, `domain/journey-step` for the
 * other two — so the panel and the schema read one number. This sentence used
 * to claim that and was wrong: `MAX_JOURNEY_NAME` was a local literal here
 * duplicating one in the route, which is exactly the drift the claim denied.
 *
 * Left advisory, because it is a *runtime* cap this code cannot read and that
 * may move under journeys already stored: `AUDITOR_MAX_PAGES_PER_RUN`. See
 * `SOFT_PAGE_ADVICE`. Enforcing that one here would put one rule in two places
 * and invalidate stored journeys the day somebody lowered it.
 *
 * `AUTHORABLE_ACTIONS` and what a step may do in which environment stay where
 * they are — this panel writes `navigate`/`goto` and nothing else.
 *
 * **One rule is neither restated nor advisory: it is enforced here and nowhere
 * else.** A crawl may return pages on subdomains of the target — it has to,
 * or the apex-to-www redirect ends every crawl at depth 0 — and a journey
 * cannot express them: it holds one `targetUrl` and a list of paths. Taking
 * the path of a page on `docs.acme.com` would post a step that audits
 * `acme.com` and get a **201** for it. No route can catch that, because there
 * is nothing wrong with the body; the host was thrown away before it was
 * written. `rowFor` refuses the row instead. See `stepPathFor`.
 */

/**
 * When the panel starts saying "that is a lot of pages".
 *
 * `deployment-config.ts` defaults `AUDITOR_MAX_PAGES_PER_RUN` to 20, and a
 * client component cannot read the deployment's actual value — which is
 * exactly why this is worded as roughly-how-many rather than as a rule. If it
 * were a rule, a panel holding a stale copy of the number would refuse
 * selections a run would happily have walked.
 *
 * Deliberately *not* the same kind of thing as `MAX_STEPS_PER_JOURNEY`, which
 * is enforced hard a few lines below. That one is a schema bound on the route
 * this panel posts to, known at build time and identical everywhere; this one
 * is a deployment's setting for a different route entirely.
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

/**
 * One page as this panel has to think about it.
 *
 * Both `stepPath` and `blockedBy` are decided per row and at *selection* time,
 * which is the whole improvement over finding out at save time: the operator
 * learns which page and why while looking at it, rather than reading a refusal
 * that names neither.
 *
 * `blockedBy` closes two of the three ways this panel could provoke a wrong
 * result. The third — the step *count* — is one click of "Select every page"
 * away and is handled by `takeable` and `createBlockedBy` instead, because it
 * is a fact about the selection rather than about any one row.
 */
type Row = {
  page: DiscoveredPage;
  index: number;
  /** What to show: the step path, or the whole URL when there is no step. */
  path: string;
  /** `null` when this page cannot be a step of this journey — see `blockedBy`. */
  stepPath: string | null;
  /** Why it cannot be ticked, in the words the row prints. `null` when it can. */
  blockedBy: string | null;
};

/**
 * The host of a discovered URL, clipped, or `null` if it cannot be read as one.
 *
 * Clipped because the value came out of a client's own markup and a hostname
 * may run to 253 characters — `describeDiscoveryFailure` bounds the host it
 * prints for the same reason and this reuses that bound rather than keeping a
 * second one.
 */
function hostOf(url: string): string | null {
  try {
    return clipHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Turn one discovered page into a row, deciding whether it can be a step.
 *
 * The two refusals are different in kind and only one of them is about this
 * panel. A path the step format cannot hold is a bound on the route below;
 * a page on another host is a page **this journey cannot express at all**, and
 * taking its path anyway would store a step that audits a different URL under
 * the operator's nose. `stepPathFor` states the rule and why it is the
 * hostname it compares.
 */
function rowFor(page: DiscoveredPage, index: number, origin: string): Row {
  const stepPath = stepPathFor(page.url, origin);

  if (stepPath === null) {
    const host = hostOf(page.url);
    const target = hostOf(origin);
    return {
      page,
      index,
      // The whole URL, because the host is the thing that makes this row
      // different and a path alone would hide it — two pages on two hosts
      // sharing a path would otherwise render as the same row twice.
      path: page.url,
      stepPath,
      blockedBy:
        host === null
          ? 'this address could not be read'
          : `on ${host}, not ${target ?? 'this site'} — a journey visits one host, so crawl ${host} on its own to audit these`,
    };
  }

  return {
    page,
    index,
    path: stepPath,
    stepPath,
    blockedBy:
      stepPath.length > MAX_STEP_TEXT
        ? `too long to record as a step (${stepPath.length} characters, limit ${MAX_STEP_TEXT})`
        : null,
  };
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
   * Every discovered page, in crawl order, already judged.
   *
   * Built once. Three separate things need the same answer — the row on
   * screen, what "select every page" may take, and what the create actually
   * posts — and deciding it three times is three chances to disagree about
   * which pages are usable.
   */
  const rows: Row[] = (found?.pages ?? []).map((page, index) =>
    rowFor(page, index, found?.origin ?? ''),
  );

  /**
   * The steps, in the order the crawl found the pages.
   *
   * Filtered out of `rows`, never spread out of `selected`. A `Set` iterates
   * in insertion order, which here is *tick* order — so a journey built from
   * it could open on a leaf page the operator happened to click first, and
   * every later step would be a navigation from somewhere unexpected.
   */
  const chosen = rows.filter((row) => selected.has(row.page.url));

  /**
   * Why the Create button is dead, or `null` when it is not.
   *
   * The step count is checked before the count of characters in a name,
   * because an operator who fixes the name first is still blocked and has
   * learned nothing. Zero pages comes first because it is the state the panel
   * opens in.
   */
  const createBlockedBy =
    chosen.length === 0
      ? 'Tick at least one page before creating a journey.'
      : chosen.length > MAX_STEPS_PER_JOURNEY
        ? // Hard, not advisory, and the distinction is where the rule is
          // decided: `authoredStepsSchema` caps the array at
          // `MAX_STEPS_PER_JOURNEY` *before* parsing an element, so a 51-step
          // body comes back as `invalid_request_body` — a code that names
          // neither the field nor the number. A url-capped crawl returns
          // exactly 100 pages, so this was one click of "Select every page"
          // away on any large site.
          `A journey holds at most ${MAX_STEPS_PER_JOURNEY} steps, and ${chosen.length} pages are picked. Untick ${chosen.length - MAX_STEPS_PER_JOURNEY}, or split this crawl across more than one journey.`
        : name.trim() === ''
          ? 'Give the journey a name before creating it.'
          : null;

  async function create() {
    if (!found || createBlockedBy) return;

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
          // `stepPath`, decided in `rowFor` — never recomputed here, and
          // never substituted. A row without one cannot be ticked, so the
          // empty branch is unreachable; it is written as a `flatMap` rather
          // than a `??` fallback because every value a fallback could supply
          // is a URL, and posting a URL where a path belongs would resolve
          // off-origin instead of failing. Nothing here may invent a step.
          steps: chosen.flatMap((row) =>
            row.stepPath === null
              ? []
              : [{ action: 'navigate', type: 'goto', path: row.stepPath }],
          ),
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
   *
   * Grouping only — every row was already decided by `rowFor` above, in crawl
   * order, so this rearranges for display and settles nothing.
   */
  const groups: Array<{ depth: number; rows: Row[] }> = [];
  rows.forEach((row) => {
    const group = groups.find((one) => one.depth === row.page.depth);
    if (group) group.rows.push(row);
    else groups.push({ depth: row.page.depth, rows: [row] });
  });
  groups.sort((a, b) => a.depth - b.depth);

  /**
   * The pages "select every page" may actually select.
   *
   * A page `rowFor` refused is not one of them — a path the step format cannot
   * hold, or a page on another host. Its checkbox is unavailable, and a bulk
   * control that ticked it anyway would put the panel in a state no click
   * could have produced and then post a journey that walks the wrong URL.
   *
   * Read off `groups`, so `takeable` below takes a prefix of the *displayed*
   * order — shallowest first. Step order is not decided here: `chosen` filters
   * `rows`, which is the crawl's own order.
   */
  const selectable = groups.flatMap((group) => group.rows.filter((row) => row.blockedBy === null));

  /**
   * What the bulk control actually takes.
   *
   * Capped, rather than left to select 100 and hand the operator a blocked
   * Create button and "untick 50" — which is a recoverable state and a
   * miserable one. Taking a storeable prefix is the same move as skipping a
   * row `rowFor` refused: leave the panel in a state the operator could have reached
   * by clicking, and say in prose what was left out. The sentence beside the
   * buttons is the half that keeps this from being a silent drop.
   *
   * Not a substitute for `createBlockedBy`, which still refuses 51 pages
   * ticked by hand. This makes the common path work; that makes every path
   * honest.
   */
  const takeable = selectable.slice(0, MAX_STEPS_PER_JOURNEY);

  const truncation = describeTruncation(found?.truncated);
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
          {...inertWhen(!canCrawl, discover)}
          // Holds the name still while the visible label changes underneath
          // it. `aria-disabled` is what makes this necessary: focus now stays
          // on the button, so renaming the focused control to "Looking…" is
          // announced — over the polite `role="status"` region below, which is
          // the thing actually saying the crawl started. Under `disabled` the
          // rename was free because focus had already gone to `<body>`.
          //
          // The cost, named rather than left for a reviewer to find: while the
          // crawl runs, the visible label is not contained in the accessible
          // name, which is what 1.4.10's neighbour 2.5.3 Label in Name asks
          // for. It is not a failure anyone can act on — 2.5.3 exists so a
          // speech-input user can say what they see, and in the only state
          // where saying it does anything the two are identical. `axe` sees
          // the idle state in the sweep and agrees; this note is here because
          // the busy state is the one it never looks at.
          aria-label="Find pages"
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
        Why the button is dead, said out loud.

        The reason this line was written is no longer the reason it stays. It
        was here because a `disabled` control cannot take focus, so a screen
        reader user reached the end of the row and found nothing explaining
        it. The button is `aria-disabled` now and *is* reachable — but reaching
        it hears only its name, and "Find pages" does not say why pressing it
        does nothing. Describing the button with this sentence would be the
        tighter binding and is not free: it is a `<p>` that comes and goes with
        the field being empty, and an `aria-describedby` pointing at an absent
        id is silently nothing.
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
        {/*
          Silent while a refusal is on screen, and that is the load-bearing
          clause. A failed second crawl deliberately leaves the first crawl's
          list where it is — blanking somebody's work over a typo'd address is
          the worse mistake — but the count then describes a site the operator
          has stopped looking at, and "Found 12 pages" re-announced beside a
          `role="alert"` saying the crawl failed is two regions contradicting
          each other. The list stays; the claim about it does not.
        */}
        {crawling
          ? 'Looking for pages…'
          : found && !crawlError
            ? `Found ${found.pages.length === 1 ? '1 page' : `${found.pages.length} pages`}.`
            : ''}
      </p>

      {truncation ? <p style={noteStyle}>{truncation}</p> : null}

      {found && found.pages.length > 0 ? (
        <>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setSelected(new Set(takeable.map((row) => row.page.url)))}
              style={buttonStyle}
            >
              Select every page
            </button>
            <button type="button" onClick={() => setSelected(new Set())} style={buttonStyle}>
              Clear the selection
            </button>
          </span>

          {selectable.length > MAX_STEPS_PER_JOURNEY ? (
            /*
              Said before the click, not after it. A crawl stopped by the URL
              cap returns exactly `MAX_DISCOVERY_URLS` pages — twice what a
              journey can hold — so on any large site this is the first thing
              the bulk control does, and an operator who is not told is one who
              thinks the button half-worked.
            */
            <p style={noteStyle}>
              {/*
                `selectable`, said as "can use" rather than as what the crawl
                found. The two differ whenever `rowFor` refused a row, and the
                status region directly above already states the crawl's total —
                two numbers for the same noun, a paragraph apart, is a screen
                arguing with itself.
              */}
              {selectable.length} of these pages can go in a journey, and a journey holds at most{' '}
              {MAX_STEPS_PER_JOURNEY} steps, so “Select every page” takes the first{' '}
              {MAX_STEPS_PER_JOURNEY}. The rest need a journey of their own.
            </p>
          ) : null}

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
                {group.rows.map(({ page, index, path, blockedBy }) => {
                  const boxId = `${fieldPrefix}-page-${index}`;
                  // Branched on, not `page.title || path`. Playwright's
                  // `page.title()` returns `''` for a document with no
                  // `<title>`, which is ordinary on real sites — and `||`
                  // there makes the accessible name "/pricing/teams
                  // /pricing/teams", said twice to a screen reader and printed
                  // twice on screen. Trimmed, because a title of spaces is the
                  // same absence.
                  const title = page.title.trim();

                  return (
                    <li key={page.url} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      {/*
                        Really `disabled`, and deliberately not `inertWhen`.
                        That helper is for a control the operator's own click
                        makes unavailable, where the browser takes focus off
                        the thing they just pressed — see `lib/inert-button`.
                        This box is unavailable on arrival, from a fact about
                        the page's address — its length, or its host: no click
                        of theirs took it away and there was never focus here
                        to lose. The reason is in the
                        `<label>` beside it, which is part of this control's
                        accessible name and is read whether it can be ticked or
                        not, so the explanation a dead control owes the screen
                        is already paid. (`inertWhen` is also typed for a
                        button's `onClick` and does not fit an `onChange`.)
                      */}
                      <input
                        id={boxId}
                        type="checkbox"
                        checked={selected.has(page.url)}
                        onChange={() => toggle(page.url)}
                        disabled={blockedBy !== null}
                      />
                      <label
                        htmlFor={boxId}
                        style={{
                          fontFamily: FONT.sans,
                          fontSize: 12.5,
                          color: blockedBy === null ? T.ink : T.inkMuted,
                        }}
                      >
                        {title === '' ? null : <>{title} </>}
                        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                          {path}
                        </span>
                        {blockedBy === null ? null : (
                          /*
                            The rule, beside the row it applies to, rather than
                            as a refusal after the journey is posted — or, for
                            the host case, rather than not at all. The page
                            stays visible either way: it is a real page the
                            crawl really found, and hiding it would leave the
                            operator wondering what was missed.

                            Two reasons reach here. A path longer than
                            `MAX_STEP_TEXT` would come back from the route as
                            `invalid_request_body`, naming neither the page nor
                            the rule. A page on another host would come back
                            **201** — and then audit a URL nobody picked, which
                            is the worse of the two by a wide margin and the
                            one nothing would have reported.

                            Same convention as the two inert buttons in this
                            panel: never a dead control without visible prose
                            saying why.
                          */
                          <span style={{ color: T.caution }}> — {blockedBy}.</span>
                        )}
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
                // The route's own cap, met while typing. Past it the create
                // answers `invalid_request_body`, which names no field.
                maxLength={MAX_JOURNEY_NAME}
                // The address box takes Enter and this one sat immediately
                // above a Create button and did not, which is asymmetry an
                // operator has to learn rather than guess.
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !creating && !createBlockedBy) void create();
                }}
                aria-invalid={createError ? true : undefined}
                aria-describedby={[nameNoteId, createError ? nameErrorId : null]
                  .filter(Boolean)
                  .join(' ')}
                style={{ ...inputStyle, fontFamily: FONT.sans, width: '100%' }}
              />
            </span>

            <button
              type="button"
              {...inertWhen(creating || createBlockedBy !== null, create)}
              // Stable for the same reason as "Find pages" above, including
              // the 2.5.3 note, and with a second reason here: this button
              // spends most of its life inert because `createBlockedBy` is
              // set, and the sentence explaining why is the live region
              // immediately below it.
              aria-label="Create journey"
              style={{ ...buttonStyle, ...disabledStyle(creating || createBlockedBy !== null) }}
            >
              {creating ? 'Creating…' : 'Create journey'}
            </button>
          </span>

          {/*
            A live region as well as an `aria-describedby` target, because the
            count changes without focus moving. "Select every page" and "Clear
            the selection" are the two controls that alter it most, and both
            leave focus on themselves — so as a describedby target alone this
            sentence is read on *focus* and never on *change*, and a blind
            operator presses the bulk control and hears nothing at all. The
            double read is not a real collision: focus lands here by tabbing to
            the name field, which is not the moment the count changes.
          */}
          {/*
            The blocked reason lives *inside* the announced paragraph, not
            beside it. Ticking a 51st page announced "51 pages picked" and
            nothing about the Create button having just died — the count is the
            symptom and `createBlockedBy` is the remedy, and announcing the
            first without the second is the same silence the bulk controls had
            before this region existed.

            It is also still the visible prose the inert button owes the
            screen — the convention the two buttons above and the refused
            rows keep — and it is decided in one place, so the button and the
            explanation cannot reach different conclusions about whether a
            create is possible.
          */}
          <p id={nameNoteId} aria-live="polite" style={noteStyle}>
            {chosen.length === 0
              ? `Nothing picked yet. The journey will visit ${found.origin} and go to each page you tick, in the order they were found.`
              : `${chosen.length === 1 ? '1 page' : `${chosen.length} pages`} picked. The journey will visit ${found.origin} and go to each, in the order they were found.`}
            {createBlockedBy ? ` ${createBlockedBy}` : ''}
          </p>

          {chosen.length > SOFT_PAGE_ADVICE ? (
            /*
              Advice, not a limit. The real cap is `AUDITOR_MAX_PAGES_PER_RUN`
              in the runner, which truncates loudly and logs it; enforcing it
              here as well would put one rule in two places, and would
              invalidate every stored journey the day somebody lowered it.
            */
            <p style={{ ...noteStyle, color: T.caution }}>
              {/*
                The advisory stays even while `createBlockedBy` is up, because
                it carries the fact the blocker does not: a journey of 50 steps
                is legal and still mostly unaudited, since a run stops at about
                `AUDITOR_MAX_PAGES_PER_RUN` pages. An operator will not guess
                that, and it is the more consequential of the two.

                Only the closing remedy goes, because the blocker one paragraph
                up ends on the same words — the same advice twice running reads
                as a screen with nothing else to say.
              */}
              That is {chosen.length} pages. A run audits about {SOFT_PAGE_ADVICE} by default and
              stops there, so the rest would not be looked at
              {createBlockedBy ? '.' : ' — this is worth splitting into more than one journey.'}
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
