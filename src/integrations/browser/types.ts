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

export type JourneyStep =
  | { action: string; type: 'goto'; path: string }
  | { action: string; type: 'click'; selector: string }
  | ({ action: string; type: 'fill'; selector: string } & FillValue);

export type JourneyRunnerInput = {
  environment: Environment;
  journeyId: string;
  stepId: string;
  fixtureDir: string;
  artifactsDir: string;
  steps?: JourneyStep[];
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
};

export type JourneyPageMeta = {
  url: string;
  route: string;
  title: string;
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
   */
  timing: { totalMs: number; scanMs: number };
};

export type JourneyRunnerResult = {
  /**
   * Every page audited, in visit order. This used to be a single page's worth
   * of results — the journey's last — so every page walked through was
   * discarded and a journey stepping past real violations reported a clean pass.
   */
  pages: PageAudit[];
  /**
   * How many further navigations the page cap refused to audit. Non-zero means
   * this run did NOT cover the whole journey.
   */
  truncatedPages: number;
};
