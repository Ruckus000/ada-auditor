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

export type JourneyRunnerResult = {
  /** Rendered DOM. Used for platform detection, not for rule evaluation. */
  html: string;
  /** Rule results from the live page — the only source of findings. */
  axe: AxeScanResult;
  /** Pruned accessibility tree, for the advisory pass. Empty when omitted. */
  axTree: AxNodeSummary[];
  page: JourneyPageMeta;
  artifacts: JourneyArtifacts;
};
