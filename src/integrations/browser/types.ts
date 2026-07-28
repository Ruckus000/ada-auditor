import type { Environment } from '../../domain/contracts';

export type JourneyStep =
  | { action: string; type: 'goto'; path: string }
  | { action: string; type: 'click'; selector: string };

export type JourneyRunnerInput = {
  environment: Environment;
  journeyId: string;
  stepId: string;
  fixtureDir: string;
  artifactsDir: string;
  steps?: JourneyStep[];
  omitAxTree?: boolean;
  headless?: boolean;
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
