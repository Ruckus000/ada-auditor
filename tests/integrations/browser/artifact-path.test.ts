import { readdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveArtifactPrefix,
  runJourney,
} from '../../../src/integrations/browser/journey-runner';

const ARTIFACTS = join('/var/data/artifacts', 'req-123');

describe('resolveArtifactPrefix', () => {
  it('keeps a plain stepId inside the artifacts directory', () => {
    const prefix = resolveArtifactPrefix(ARTIFACTS, 'dashboard');
    expect(prefix).toBe(resolve(ARTIFACTS) + sep + 'dashboard');
  });

  it('refuses to escape via parent segments', () => {
    // Without this guard an audit run is an arbitrary file write: the caller
    // picks where screenshot/DOM/ax-tree files land and overwrites what is there.
    for (const stepId of [
      '../escape',
      '../../escape',
      '../../../../../../tmp/pwned',
      'nested/../../escape',
    ]) {
      expect(() => resolveArtifactPrefix(ARTIFACTS, stepId)).toThrow(/escape the artifacts/i);
    }
  });

  it('refuses an absolute stepId', () => {
    expect(() => resolveArtifactPrefix(ARTIFACTS, '/tmp/pwned')).toThrow(
      /escape the artifacts/i,
    );
  });

  it('refuses a stepId that resolves to the directory itself', () => {
    for (const stepId of ['.', 'nested/..']) {
      expect(() => resolveArtifactPrefix(ARTIFACTS, stepId)).toThrow(/within the artifacts/i);
    }
  });

  it('allows a nested path that stays inside', () => {
    const prefix = resolveArtifactPrefix(ARTIFACTS, 'steps/dashboard');
    expect(prefix.startsWith(resolve(ARTIFACTS) + sep)).toBe(true);
  });
});

describe('runJourney artifact containment', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'ada-artifact-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('rejects a traversing stepId without launching a browser or writing anything', async () => {
    const artifactsDir = join(workDir, 'artifacts', 'req-1');

    await expect(
      runJourney({
        environment: 'staging',
        journeyId: 'demo-login',
        stepId: '../../ESCAPED',
        fixtureDir: join(process.cwd(), 'fixtures/journey-app'),
        artifactsDir,
      }),
    ).rejects.toThrow(/escape the artifacts/i);

    // Nothing was created at all -- the check runs before mkdir and before
    // chromium.launch, so a bad stepId is cheap and leaves no residue.
    await expect(readdir(workDir)).resolves.toEqual([]);
  });
});
