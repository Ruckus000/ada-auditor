import type { Environment } from '../../domain/contracts';
import type { AxeScanResult } from '../../services/deterministic-audit';

export type JourneyStep =
  | { action: string; type: 'goto'; path: string }
  | { action: string; type: 'click'; selector: string }
  | { action: string; type: 'fill'; selector: string; value: string };

export type JourneyRunnerInput = {
  environment: Environment;
  journeyId: string;
  stepId: string;
  fixtureDir: string;
  artifactsDir: string;
  steps?: JourneyStep[];
  omitAxTree?: boolean;
  headless?: boolean;
  /** Override AUDIT_TARGET_BASE_URL for this run (http(s) staging target). */
  targetBaseUrl?: string;
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
  page: JourneyPageMeta;
  artifacts: JourneyArtifacts;
};
