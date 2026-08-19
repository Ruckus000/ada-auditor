import type { Environment } from '../../domain/contracts';
import type { AxNodeSummary } from '../../services/ax-tree';
import type { AxeScanResult } from '../../services/deterministic-audit';

/**
 * A `fill` step either types a literal value or resolves a stored credential.
 *
 * Steps arrive over HTTP and are persisted with the journey, so a password
 * must never be one of their fields. `credentialRef` names a secret the server
 * resolves at run time; the value never leaves the server, never appears in a
 * request body, and never lands in a stored journey.
 */
export type FillValue = { value: string } | { credentialRef: string; field: 'user' | 'pass' };

/**
 * What "arrived" means, declared by the operator instead of guessed.
 *
 * The runner had no way to wait for anything. A click was followed by
 * `waitForLoadState('domcontentloaded')`, which fires when the document is
 * parsed and says nothing about whether the app has rendered — so a
 * single-page app was scanned mid-transition, and a login that failed was
 * scanned as though it had succeeded. The obvious patch is a settle heuristic
 * (networkidle, or a fixed delay), and it is a guess dressed as a
 * measurement: it waits the wrong amount of time on every page and still
 * cannot tell arriving from failing.
 *
 * An expectation is both halves at once. The operator says the dashboard is
 * where `/dashboard` is in the URL, or where `#account-menu` exists, and the
 * runner waits for exactly that — then fails naming it when it never happens.
 * Waiting and asserting are the same act, so there is no separate settle to
 * get wrong.
 *
 * At least one of the two is required, and that is enforced where steps are
 * accepted rather than here — a type union cannot express "at least one
 * optional field" without doubling the variants.
 */
export type ExpectStep = {
  action: string;
  type: 'expect';
  /** Substring the settled URL must contain. */
  urlIncludes?: string;
  /** Selector that must be present and visible. */
  selector?: string;
};

export type JourneyStep =
  | { action: string; type: 'goto'; path: string }
  | { action: string; type: 'click'; selector: string }
  | ({ action: string; type: 'fill'; selector: string } & FillValue)
  | ExpectStep;

export type JourneyRunnerInput = {
  environment: Environment;
  journeyId: string;
  stepId: string;
  fixtureDir: string;
  artifactsDir: string;
  /**
   * The path to walk. Required, and deliberately so.
   *
   * This was optional, defaulting to `buildDefaultDemoJourneySteps()` inside
   * the runner — which is how a journey naming a client's site and no steps
   * came to walk our fixture login against their origin. The default still
   * exists, but only in `runBrowserAudit`, directly beside the check for the
   * one case it is legitimate in: a run with no target URL at all.
   */
  steps: JourneyStep[];
  /**
   * Per-interaction timeout. Defaults to `AUDITOR_STEP_TIMEOUT_MS`, then to
   * ten seconds — Playwright's own default of thirty applied until nothing
   * anywhere set one.
   */
  stepTimeoutMs?: number;
  /**
   * How long an `expect` step may wait. Defaults to
   * `AUDITOR_EXPECT_TIMEOUT_MS`, then to thirty seconds — deliberately longer
   * than `stepTimeoutMs`, because an expectation spans an arrival rather than
   * finding a control on a page that has already arrived.
   */
  expectTimeoutMs?: number;
  omitAxTree?: boolean;
  headless?: boolean;
  /**
   * Origin of the site under audit. When set, `goto` paths resolve against it
   * and every navigation is checked against `allowedHosts`. When unset, the
   * run uses local `file://` fixtures.
   */
  targetUrl?: string;
  /** Hosts this run may navigate to. Defaults to the target's own host. */
  allowedHosts?: string[];
  /**
   * Most pages this run will audit. Defaults to `AUDITOR_MAX_PAGES_PER_RUN`, or
   * 20. Every page costs an axe scan, a full-page screenshot and an AX tree
   * against the same 300s function ceiling, so the ceiling is explicit — and
   * when it truncates a journey the run says so rather than reporting a partial
   * audit as a complete one.
   */
  maxPages?: number;
  /**
   * Walk and capture without evaluating rules. The preview endpoint's whole
   * point: an authoring check should cost navigation, not an audit. `passCount`
   * stays absent — "not measured" and "zero passes" are different facts.
   */
  skipScan?: boolean;
};

export type JourneyPageMeta = {
  url: string;
  route: string;
  title: string;
  /**
   * The main-frame HTTP status this page was served with, when there was one.
   *
   * Absent means not measured, not 200: a `file://` fixture run has no HTTP
   * status, and neither does a capture whose settled URL never appeared as a
   * main-frame navigation response.
   */
  statusCode?: number;
};

export type JourneyArtifacts = {
  screenshotPath?: string;
  domSnapshotPath?: string;
  axTreePath?: string;
};

/**
 * One page the journey visited, scanned in the state the journey left it in.
 *
 * Each page carries its own evidence, so a finding can be traced to the exact
 * screenshot and DOM it came from rather than to whatever the run happened to
 * end on.
 */
export type PageAudit = {
  page: JourneyPageMeta;
  /** Rendered DOM. Used for platform detection, not for rule evaluation. */
  html: string;
  /** Rule results from the live page — the only source of findings. */
  axe: AxeScanResult;
  /** Pruned accessibility tree, for the advisory pass. Empty when omitted. */
  axTree: AxNodeSummary[];
  artifacts: JourneyArtifacts;
  /** Filesystem- and URL-safe id for this page's artifact set within the run. */
  pageKey: string;
  /**
   * What this page cost, in wall clock.
   *
   * The page cap and the 300s function limit were both set by guess. This is
   * the measurement that decides whether they are the right numbers — and the
   * unit is deliberately the whole capture, navigate-settle through
   * artifacts-written, because that is what the cap is denominated in.
   *
   * `scanMs` is absent, not zero, when `skipScan` skipped the measurement
   * entirely — the same "not measured" convention `AxeScanResult.passCount`
   * follows, and for the same reason.
   */
  timing: { totalMs: number; scanMs?: number };
};

export type JourneyRunnerResult = {
  /**
   * Every page audited, in visit order. This used to be a single page's worth
   * of results — the journey's last — so every page walked through was
   * discarded and a journey stepping past real violations reported a clean pass.
   *
   * Every page *of the target site*. A journey may pass through another host —
   * an identity provider — and those pages are deliberately not captured: they
   * are not the client's site and their defects are not the client's to fix.
   * See the pass-through skip in `capturePage`.
   */
  pages: PageAudit[];
  /**
   * How many further navigations the page cap refused to audit. Non-zero means
   * this run did NOT cover the whole journey.
   */
  truncatedPages: number;
};
