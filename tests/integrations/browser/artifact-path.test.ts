import { readdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  pageKeyFor,
  resolveArtifactPrefix,
  routeFromPageUrl,
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

describe('routeFromPageUrl', () => {
  it('names a directory-style URL by its path, not by nothing at all', () => {
    // The regression this suite exists for. Every one of these ends in a
    // slash, so the old "last path segment" rule popped the empty string and
    // labelled all of them `/`. A real run against `https://www.w3.org/WAI/`
    // reported six pages, every one called `/`, which is what a client would
    // have read in the report.
    expect(routeFromPageUrl('https://www.w3.org/WAI/')).toBe('/WAI');
    expect(routeFromPageUrl('https://acme.test/products/checkout/')).toBe('/products/checkout');
    expect(routeFromPageUrl('https://acme.test/a/b/c/')).toBe('/a/b/c');
  });

  it('keeps distinct pages distinct', () => {
    // The property that actually matters: two different pages must not share
    // a label, or the findings list cannot say which page a violation is on.
    const routes = [
      'https://www.w3.org/WAI/',
      'https://www.w3.org/WAI/standards-guidelines/',
      'https://www.w3.org/WAI/test-evaluate/',
    ].map(routeFromPageUrl);

    expect(new Set(routes).size).toBe(routes.length);
  });

  it('treats a directory, its index and the bare path as one page', () => {
    for (const url of [
      'https://acme.test/help/',
      'https://acme.test/help/index.html',
      'https://acme.test/help',
    ]) {
      expect(routeFromPageUrl(url)).toBe('/help');
    }
  });

  it('calls the site root `/`', () => {
    expect(routeFromPageUrl('https://acme.test/')).toBe('/');
    expect(routeFromPageUrl('https://acme.test')).toBe('/');
    expect(routeFromPageUrl('https://acme.test/index.html')).toBe('/');
  });

  it('keeps a file URL to its basename', () => {
    // A file pathname is an absolute path on whoever ran the audit. Reporting
    // it would put a home directory in the client's report and in an artifact
    // filename; the fixtures are the only thing that uses this shape.
    expect(routeFromPageUrl('file:///home/someone/fixtures/login.html')).toBe('/login.html');
    expect(routeFromPageUrl('file:///home/someone/fixtures/index.html')).toBe('/');
  });

  it('survives being turned into an artifact filename', () => {
    // `route` is not only a label: it becomes part of a path on disk. A
    // deeper route must still slugify to something safe and unique.
    expect(pageKeyFor(0, routeFromPageUrl('https://www.w3.org/WAI/'))).toBe('01-wai');
    expect(pageKeyFor(1, routeFromPageUrl('https://acme.test/products/checkout/'))).toBe(
      '02-products-checkout',
    );
    expect(pageKeyFor(2, routeFromPageUrl('https://acme.test/'))).toBe('03');
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
        // Not the subject here, and never walked: the stepId check runs first.
        steps: [],
      }),
    ).rejects.toThrow(/escape the artifacts/i);

    // Nothing was created at all -- the check runs before mkdir and before
    // chromium.launch, so a bad stepId is cheap and leaves no residue.
    await expect(readdir(workDir)).resolves.toEqual([]);
  });
});
