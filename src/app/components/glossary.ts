/**
 * Every explanation the UI shows lives here.
 *
 * Rules for editing this file:
 * - `short` is the hover/focus tooltip. One sentence. No jargon inside it.
 * - `detail` appears when the tip is pinned open. Two or three sentences max.
 * - Semantics must match the domain layer. Each entry notes its source of truth.
 *   If you change behaviour there, change the copy here in the same commit.
 */

export interface GlossaryEntry {
  /** The label as it appears in the UI. Also the glossary section heading. */
  term: string;
  /** One line. Shown on hover and on keyboard focus. */
  short: string;
  /** Optional second paragraph, shown when the tip is pinned open. */
  detail?: string;
}

export const GLOSSARY = {
  // --- Run configuration -------------------------------------------------

  environment: {
    term: 'Target environment',
    short: 'Controls what the auditor is allowed to do to the site it is testing.',
    detail:
      'Lower levels let the auditor interact more. Production is the most restricted: it may only look, navigate, and log in — never submit forms or change data. Staging and preview also allow safe form submissions. Test additionally allows creating and modifying test data.',
  },

  envProduction: {
    term: 'production',
    short: 'Read-only. The auditor may log in, navigate, search, filter, paginate, and open detail views — nothing else.',
    detail:
      'No form submissions, no data changes. Use this when the target is a real site serving real customers. It is the safest setting and also the most limited, so some journeys cannot be completed here.',
  },

  envStaging: {
    term: 'staging',
    short: 'Everything production allows, plus safe form submissions. The recommended default.',
    detail: 'A copy of the real site with fake data. The best place to practise and to run most audits.',
  },

  envPreview: {
    term: 'preview',
    short: 'Same permissions as staging. Intended for per-branch deploy previews.',
    detail: 'Use this when auditing a short-lived preview deployment rather than a long-lived staging site.',
  },

  envTest: {
    term: 'test',
    short: 'The most permissive level — safe submissions plus creating and modifying test data.',
    detail: 'Only point this at a throwaway environment. The auditor may leave data behind.',
  },

  runMode: {
    term: 'What to audit',
    short: 'Choose between driving a real browser through the demo site, or checking a block of HTML you paste in.',
    detail:
      'A browser run is the real thing: it captures screenshots and an accessibility tree, so the result can be trusted as a pass or fail. Pasted HTML is a quick check only.',
  },

  browserMode: {
    term: 'Demo journey (real browser)',
    short: 'Drives a real browser through the built-in demo site and captures real evidence.',
    detail:
      'This is the only mode that can produce complete evidence, so it is the only mode that can return a definitive pass or fail. It takes a few seconds because a browser actually starts up.',
  },

  htmlMode: {
    term: 'Pasted HTML',
    short: 'Checks a block of markup without opening a browser.',
    detail:
      'Fast, but no screenshot or accessibility tree is captured — the evidence is stubbed. Useful for trying a rule out; not a substitute for a browser run.',
  },

  platformHint: {
    term: 'Platform',
    short: 'Tells the auditor what the site is built with, so it does not have to guess.',
    detail:
      'A stated platform always beats guesswork from the HTML. React unlocks single-page navigation and component hints; WordPress unlocks CMS template hints. Leave it on auto-detect if you are unsure.',
  },

  journeyId: {
    term: 'Journey ID',
    short: 'The name of the path through the site being tested, such as logging in and reaching the dashboard.',
    detail:
      'The run contract lists which journeys are permitted. If you enter a name that is not on that list, the run is refused before anything is tested.',
  },

  // --- Verdicts ----------------------------------------------------------

  verdict: {
    term: 'Verdict',
    short: 'The single outcome of the run: pass, fail, or inconclusive.',
    detail: 'This is the value automated pipelines read to decide whether to let a build through.',
  },

  pass: {
    term: 'Pass',
    short: 'Evidence was complete and no critical rule-based issues were found.',
    detail: 'Nothing found here should block a release. It does not mean the site is free of accessibility problems.',
  },

  fail: {
    term: 'Fail',
    short: 'Evidence was complete and at least one critical rule-based issue was found.',
    detail: 'Only critical issues from fixed rules cause a fail. Advisory notes never do.',
  },

  inconclusive: {
    term: 'Inconclusive',
    short: 'The auditor could not capture enough evidence to judge, so it refuses to say pass or fail.',
    detail:
      'This is deliberate. A missing screenshot or accessibility tree means the checks were not looking at the whole picture, and reporting a pass from partial evidence would be a false all-clear.',
  },

  // --- Evidence ----------------------------------------------------------

  evidence: {
    term: 'Evidence',
    short: 'What a page has to produce before anything it shows can be judged: a screenshot, a DOM snapshot, an accessibility tree — and an HTTP status that was not an error.',
    detail:
      'All three artifacts must be present, and the page must not have been served as 400 or above. If an artifact is missing, or the page came back 404, 403 or 500, the evidence is degraded: its findings are not reported, the run is not scored, and the verdict becomes inconclusive. An error page is small and clean, so counting one would score a run higher than a real audit of the page it stood in for.',
  },

  screenshot: {
    term: 'Screenshot',
    short: 'A picture of the page as it actually rendered.',
  },

  domSnapshot: {
    term: 'DOM snapshot',
    short: 'The page structure as the browser built it, after scripts have run.',
    detail: 'This differs from the HTML the server sent, which is why pasted markup is a weaker check.',
  },

  axTree: {
    term: 'Accessibility tree',
    short: 'What assistive technology, such as a screen reader, actually perceives on the page.',
    detail:
      'The most important artifact of the three. Without it, the auditor cannot tell what a screen reader would announce, so it will not issue a pass or fail.',
  },

  // --- Findings ----------------------------------------------------------

  deterministic: {
    term: 'Rule-based finding',
    short: 'Found by a fixed rule with no AI involved. These are the only findings that can fail a build.',
    detail:
      'Rules produce the same answer every time for the same input. Because they are repeatable, they are trusted to gate releases — but only when evidence is complete.',
  },

  advisory: {
    term: 'Advisory note',
    short: 'An AI suggestion worth a human look. It never affects the verdict.',
    detail:
      'Advisory notes carry a confidence score and are shown only above a threshold. Treat them as leads to investigate, not as confirmed defects.',
  },

  severity: {
    term: 'Severity',
    short: 'How serious a finding is: critical, major, or minor.',
    detail: 'Only critical rule-based findings cause a fail. Major and minor are reported for you to triage.',
  },

  blocksCi: {
    term: 'Blocks release',
    short: 'This finding is critical and rule-based, so it is what turned the verdict to fail.',
  },

  // --- Comparison & tracing ----------------------------------------------

  regression: {
    term: 'Compared to last run',
    short: 'How this run differs from the previous run of the same journey in the same environment.',
    detail:
      'Only rule-based findings are compared. A newly appearing critical issue is reported as a failure; any other new issue is reported as a warning.',
  },

  traceId: {
    term: 'Trace ID',
    short: 'The unique reference for this run. Quote it when reporting a problem.',
    detail: 'It appears in the server log and names the folder where this run stored its evidence files.',
  },

  duration: {
    term: 'Duration',
    short: 'How long the run took, end to end, in milliseconds.',
  },

  // --- System status -----------------------------------------------------

  platformUp: {
    term: 'Service reachable',
    short: 'Whether this app is responding at all.',
  },

  canRunAudits: {
    term: 'Ready to run',
    short: 'Whether the server has been given the secret it needs to start an audit.',
    detail:
      'Audits are authorised with a token held on the server. Until it is configured, the run button stays disabled.',
  },

  consoleUnlock: {
    term: 'Run token',
    short:
      'The shared secret the server uses to authorise audits. The console asks for it once, then remembers you.',
    detail:
      'Running an audit spends real resources, so the console has to know you are allowed to. Unlocking stores a signed, browser-only cookie for 30 days — the token itself is never kept in the browser. Changing the token on the server locks every console again.',
  },

  chaosDemo: {
    term: 'Practice mode',
    short: 'Runs a simulated audit rigged to produce a specific verdict, so you can see what each one looks like.',
    detail:
      'These are demonstrations, not real audits — nothing is genuinely tested. They exist so the meaning of each verdict, especially inconclusive, is something you can see rather than just read about.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/**
 * Widening lookup. `as const` above gives us exact key inference, but it also
 * narrows each entry to its own literal shape, so `detail` is invisible on the
 * entries that omit it. Read entries through here to get the common type.
 */
export function glossaryEntry(key: GlossaryKey): GlossaryEntry {
  return GLOSSARY[key];
}

/** Stable DOM id for a term's entry in the on-page glossary section. */
export function glossaryAnchorId(key: GlossaryKey): string {
  return `glossary-${key}`;
}

/**
 * Plain-English handling for every error the API can return.
 *
 * Keys are the exact `error` strings emitted by the route handlers. Anything
 * unrecognised falls through to `describeApiError`'s generic branch, which still
 * shows the raw code so support has something to search on.
 */
export interface ApiErrorCopy {
  title: string;
  cause: string;
  fix: string;
}

export const API_ERRORS: Record<string, ApiErrorCopy> = {
  auditor_run_token_not_configured: {
    title: 'The server has no run token',
    cause:
      'Audits are authorised with a secret held on the server, and it has not been set yet.',
    fix: 'Add AUDITOR_RUN_TOKEN to .env.local (or to your Vercel environment variables), restart the app, then press Re-check.',
  },
  console_same_origin_required: {
    title: 'This request did not come from the console',
    cause:
      'For safety, this endpoint only accepts requests made from this page in a browser.',
    fix: 'Reload the page and try again. If you are calling the API from a script, use /api/audit/run with a bearer token instead.',
  },
  console_session_required: {
    title: 'The console is locked',
    cause:
      'This browser has no valid operator session — it either never unlocked, or the session expired or was invalidated by a token change.',
    fix: 'Unlock the console with the run token and run again.',
  },
  invalid_token: {
    title: 'That token was not accepted',
    cause: 'The value entered does not match AUDITOR_RUN_TOKEN on the server.',
    fix: 'Copy the value from .env.local exactly, without surrounding quotes or spaces.',
  },
  too_many_attempts: {
    title: 'Too many failed unlock attempts',
    cause: 'Repeated wrong tokens from this address, so unlocking is paused briefly.',
    fix: 'Wait five minutes, then try again with the correct token.',
  },
  auditor_run_token_too_weak: {
    title: 'The server token is too short to unlock with',
    cause:
      'AUDITOR_RUN_TOKEN is under 16 characters, which is too easy to guess for something that gates real audit runs.',
    fix: 'Generate a longer one — openssl rand -hex 32 — set it on the server, and restart the app.',
  },
  unauthorized: {
    title: 'The run token was missing or wrong',
    cause: 'The request reached the audit endpoint without a valid token.',
    fix: 'Check that AUDITOR_RUN_TOKEN on the server matches the token being sent.',
  },
  invalid_request_body: {
    title: 'The run request was rejected',
    cause: 'One of the values sent with the run was missing or not a valid choice.',
    fix: 'Check the Journey ID is not empty and, in pasted-HTML mode, that the HTML box has content.',
  },
  chaos_not_enabled: {
    title: 'Practice mode is switched off',
    cause: 'Simulated runs are only available when the server has them enabled.',
    fix: 'Set CHAOS_ENABLED=true in .env.local and restart the app.',
  },
  invalid_chaos_scenario: {
    title: 'Unknown practice scenario',
    cause: 'The requested simulation is not one the server recognises.',
    fix: 'Reload the page and try again.',
  },
  // Run failures. The server maps internal exceptions to these stable codes
  // rather than echoing exception text, so these keys are a contract, not a
  // copy of whatever string was thrown.
  journey_not_in_scope: {
    title: 'That journey is not permitted',
    cause:
      'The run contract lists which journeys may be audited, and the Journey ID you entered is not on it.',
    fix: 'Open Advanced settings and set Journey ID back to demo-login.',
  },
  action_not_allowed: {
    title: 'The journey needed an action this environment forbids',
    cause:
      'Completing this journey required an interaction that the selected target environment does not permit.',
    fix: 'Choose a less restrictive environment — staging allows safe form submissions, production does not.',
  },
  invalid_step_id: {
    title: 'The step name was rejected',
    cause: 'Step names become filenames, so they may only contain letters, numbers, hyphens and underscores.',
    fix: 'Use a plain name such as dashboard.',
  },
  audit_run_failed: {
    title: 'The run did not finish',
    cause: 'The auditor stopped partway through for a reason it could not categorise.',
    fix: 'Try again. If it keeps happening, copy the trace ID below — the server log records the detail.',
  },
};

export function describeApiError(raw: string | undefined, httpStatus: number): ApiErrorCopy {
  if (raw && API_ERRORS[raw]) {
    return API_ERRORS[raw];
  }

  if (httpStatus === 0) {
    return {
      title: 'Could not reach the server',
      cause: 'The request never completed — the app may have stopped, or the network dropped.',
      fix: 'Check the app is still running, then try again.',
    };
  }

  return {
    title: 'The run did not finish',
    cause: raw
      ? 'The auditor stopped with an error it could not translate into plain English.'
      : 'The auditor stopped without explaining why.',
    fix: 'Try again. If it keeps happening, copy the trace ID below and report it.',
  };
}
