import type { Environment } from '../../domain/contracts';

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
  html: string;
  page: JourneyPageMeta;
  artifacts: JourneyArtifacts;
};
