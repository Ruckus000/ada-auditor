import { describe, expect, it } from 'vitest';
import { classifyRunFailure } from '../../src/app/api/_lib/run-failure';
import {
  describeDepth,
  describeDiscoveryFailure,
  describeErrorTotal,
  describeJourneyCreationFailure,
  describeTruncation,
} from '../../src/app/platform/lib/discovery-copy';

/**
 * The words the discovery panel puts on screen.
 *
 * `run-failure-copy.ts` shipped untested and both defects a review later found
 * were in the half nothing exercised — a sentence describing a state that does
 * not exist, and a lookup that turned an unrecognised code into a 500. This is
 * the same shape of module, so it gets the tests that one did not.
 */

/**
 * Every code `POST /api/platform/discover` can put in an `error` field.
 *
 * Read off the route: `unauthorized` (401), `invalid_request_body` (400),
 * `entry_point_redirected` (400), `entry_point_unreachable` (502),
 * whatever `classifyRunFailure` returns for an `UnsafeTargetError` (400), and
 * `discovery_failed` (500).
 */
const DISCOVERY_CODES = [
  'unauthorized',
  'invalid_request_body',
  'entry_point_redirected',
  'entry_point_unreachable',
  'navigation_not_allowed',
  'discovery_budget_exceeded',
  'discovery_failed',
];

describe('describeDiscoveryFailure', () => {
  it('answers every code the route can emit with something to do', () => {
    for (const code of DISCOVERY_CODES) {
      const copy = describeDiscoveryFailure(code);

      // Not the bare code, and not our own bookkeeping: an operator cannot act
      // on `entry_point_unreachable`, and printing it teaches them the answer
      // lives somewhere they cannot reach.
      expect(copy, code).not.toContain(code);
      // A verb they can perform. Every sentence here ends in an instruction,
      // which is the whole standard `run-failure-copy.ts` sets.
      expect(copy, code).toMatch(/try again|reload|instead|check|needs|is what this needs/i);
    }
  });

  it('gives the refusals their own answers rather than the catch-all', () => {
    // The half that would otherwise rot: a `switch` whose specific branches
    // were deleted still returns a sentence for every code above.
    const fallback = describeDiscoveryFailure('discovery_failed');

    for (const code of DISCOVERY_CODES.filter((one) => one !== 'discovery_failed')) {
      expect(describeDiscoveryFailure(code), code).not.toBe(fallback);
    }
  });

  it('passes on the budget refusal in the route\'s words, which say when it resets', () => {
    // The fallback's "try again" is the one instruction a budget refusal makes
    // wrong: the crawl will be refused again until the window turns. The route
    // ships the sentence with the reset time; this prints it.
    const copy = describeDiscoveryFailure('discovery_budget_exceeded', {
      message: 'Discovery is capped at 60 per hour and this hour is spent. It resets in 12 minutes.',
    });

    expect(copy).toContain('12 minutes');
    expect(describeDiscoveryFailure('discovery_budget_exceeded')).toMatch(/capped/i);
  });

  it('names the host a redirect settled on', () => {
    // The route ships `host` as structured data precisely so this sentence can
    // name it. Discovery exists to save an operator from finding out where
    // their pages are; a refusal that will not say where the address went
    // hands that work straight back.
    const copy = describeDiscoveryFailure('entry_point_redirected', { host: 'www.example.org' });

    expect(copy).toContain('www.example.org');
  });

  it('stays a sentence when the host is missing', () => {
    // `details` is optional and the field is absent on any response shape but
    // one, so an implementation that interpolated it unguarded would print
    // "redirects to undefined".
    const copy = describeDiscoveryFailure('entry_point_redirected');

    expect(copy).not.toMatch(/undefined|null/);
    expect(copy).toMatch(/redirects/i);
  });

  it('clips a host rather than printing whatever the redirect said', () => {
    // The value came from somebody else's server. Unclipped, a 2000-character
    // host pushes the rest of the panel off the screen.
    const copy = describeDiscoveryFailure('entry_point_redirected', { host: 'a'.repeat(500) });

    expect(copy.length).toBeLessThan(300);
    expect(copy).toContain('…');
  });

  it('survives a code that collides with Object.prototype', () => {
    // The code arrives off a parsed JSON body, so `__proto__` is a value a
    // caller can send. On an object literal it resolves through the prototype
    // chain to a non-string, which React renders by throwing.
    for (const hostile of ['__proto__', 'constructor', 'toString']) {
      expect(typeof describeDiscoveryFailure(hostile)).toBe('string');
      expect(describeDiscoveryFailure(hostile)).toBe(describeDiscoveryFailure('discovery_failed'));
    }
  });

  it('has an answer for the code the SSRF guard really produces', () => {
    // Not the string we assumed: the route classifies an `UnsafeTargetError`
    // through the same function the runner uses, and that function keys on the
    // error's *name*. If it ever returns something else, this copy is orphaned.
    const code = classifyRunFailure('Target URL resolves to a private or reserved address.', 'UnsafeTargetError');

    expect(code).toBe('navigation_not_allowed');
    expect(describeDiscoveryFailure(code)).not.toBe(describeDiscoveryFailure('discovery_failed'));
  });
});

describe('describeJourneyCreationFailure', () => {
  it('does not send an operator back to the address after the crawl succeeded', () => {
    // The reason there are two maps. `client_not_found` from the create route
    // means the client vanished, and the discovery map's instinct — "check the
    // address and try again" — is advice about a URL that already worked.
    const copy = describeJourneyCreationFailure('client_not_found');

    expect(copy).toMatch(/reload/i);
    expect(copy).not.toMatch(/address/i);
  });

  it('names every bound that can produce it, count as well as length', () => {
    // Two sentences have already been wrong here, both by listing a remedy
    // that could not apply. The first told operators to "give the journey a
    // name and pick at least one page", which the panel guarantees before it
    // will POST. The second named only *lengths* — and the bound most likely
    // to fire is a *count*: `authoredStepsSchema` caps the array at
    // `MAX_STEPS_PER_JOURNEY` (50), while a url-capped crawl returns 100
    // pages, so "shorten the name or untick the longest page" is advice
    // nobody in that state can act on.
    const copy = describeJourneyCreationFailure('invalid_request_body');

    expect(copy).toMatch(/too many pages/i);
    expect(copy).toMatch(/too long/i);
    expect(copy).toMatch(/fewer pages/i);
    expect(copy).not.toMatch(/at least one page/i);
  });

  it('shares no code with the discovery map where the answers would differ', () => {
    expect(describeJourneyCreationFailure('client_not_found')).not.toBe(
      describeDiscoveryFailure('client_not_found'),
    );
  });

  it('tells an operator their selection survived an unknown failure', () => {
    // The panel keeps the selection on anything but a 201, and a fallback that
    // did not say so invites re-running the crawl to get the list back.
    expect(describeJourneyCreationFailure('something_new')).toMatch(/still selected/i);
  });

  it('survives a code that collides with Object.prototype', () => {
    for (const hostile of ['__proto__', 'constructor', 'toString']) {
      expect(typeof describeJourneyCreationFailure(hostile)).toBe('string');
    }
  });
});

describe('describeTruncation', () => {
  it('says nothing when the crawl was whole', () => {
    // A banner on every crawl is a banner nobody reads on the one that matters.
    expect(describeTruncation(undefined)).toBeNull();
  });

  it('reports `seen` as a floor, never as a total', () => {
    // `seen` errs upward on a redirect-heavy site, so printing it as a count
    // puts a number on screen the list below contradicts.
    const copy = describeTruncation({ reason: 'url-cap', seen: 137 });

    expect(copy).toContain('At least 137');
    expect(copy).toMatch(/not all of it/i);
  });

  it('tells the two reasons apart', () => {
    // They need different next actions — a page limit is ours, a time limit is
    // the site's — and a shared sentence would hide which one fired.
    expect(describeTruncation({ reason: 'budget', seen: 40 })).not.toBe(
      describeTruncation({ reason: 'url-cap', seen: 40 }),
    );
    expect(describeTruncation({ reason: 'budget', seen: 40 })).toMatch(/time/i);
    expect(describeTruncation({ reason: 'url-cap', seen: 40 })).toMatch(/limit/i);
  });
});

describe('describeErrorTotal', () => {
  it('counts the failures the ceiling discarded, not the ones it kept', () => {
    // The defect this exists to stop: a heading built from `errors.length`
    // alone reads as "100 problems" on a site with 300.
    const copy = describeErrorTotal(100, 200);

    expect(copy).toContain('300');
    expect(copy).toContain('first 100');
  });

  it('does not claim a shorter list when nothing was dropped', () => {
    const copy = describeErrorTotal(3, 0);

    expect(copy).toContain('3 pages');
    expect(copy).not.toMatch(/first/i);
  });

  it('agrees with itself about one page', () => {
    expect(describeErrorTotal(1, 0)).toContain('1 page could');
  });

  it('does not say "The first 1 are listed below"', () => {
    // The commonest truncated shape there is: a hub of dead links fills the
    // ceiling, and the list under this heading is one row long.
    const copy = describeErrorTotal(1, 4);

    expect(copy).toContain('The first one is listed below.');
    expect(copy).not.toMatch(/first 1 /);
  });
});

describe('describeDepth', () => {
  it('names the entry page as the address the operator typed', () => {
    // Depth 0 is not "zero clicks away", which is a sentence about arithmetic.
    expect(describeDepth(0)).toMatch(/address you gave/i);
  });

  it('says every depth the crawl can reach in words', () => {
    // `MAX_DISCOVERY_DEPTH` is 3 and inclusive, so 0-3 are the real cases; a
    // group heading reading "3" would be the number this function exists to
    // replace.
    for (const depth of [0, 1, 2, 3]) {
      expect(describeDepth(depth), String(depth)).not.toMatch(/^\d/);
    }
  });

  it('still says something if the crawl ever walks further', () => {
    expect(describeDepth(7)).toBe('7 clicks from there');
  });
});
