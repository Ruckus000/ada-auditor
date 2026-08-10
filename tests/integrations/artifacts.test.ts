import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlobArtifactStore,
  NoopArtifactStore,
  isBlobConfigured,
  retentionDays,
} from '../../src/integrations/artifacts/blob-store';

describe('retentionDays', () => {
  const original = process.env.ARTIFACT_RETENTION_DAYS;

  afterEach(() => {
    if (original === undefined) delete process.env.ARTIFACT_RETENTION_DAYS;
    else process.env.ARTIFACT_RETENTION_DAYS = original;
  });

  it('defaults to 30 days', () => {
    delete process.env.ARTIFACT_RETENTION_DAYS;
    expect(retentionDays()).toBe(30);
  });

  it('honours an explicit window', () => {
    process.env.ARTIFACT_RETENTION_DAYS = '7';
    expect(retentionDays()).toBe(7);
  });

  it.each(['0', '-5', 'forever', ''])(
    'falls back to the default rather than never expiring on %j',
    (value) => {
      // A misconfigured window must not silently mean "keep client screenshots
      // indefinitely".
      process.env.ARTIFACT_RETENTION_DAYS = value;
      expect(retentionDays()).toBe(30);
    },
  );
});

describe('isBlobConfigured', () => {
  const original = process.env.BLOB_READ_WRITE_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = original;
  });

  it('follows the token', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(isBlobConfigured()).toBe(false);

    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
    expect(isBlobConfigured()).toBe(true);
  });
});

describe('BlobArtifactStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ada-artifacts-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function fixtureArtifacts() {
    const screenshotPath = join(dir, 'dashboard.png');
    const domSnapshotPath = join(dir, 'dashboard.html');
    const axTreePath = join(dir, 'dashboard.ax.json');
    await writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(domSnapshotPath, '<html></html>');
    await writeFile(axTreePath, '{"nodes":[]}');
    return { screenshotPath, domSnapshotPath, axTreePath };
  }

  it('uploads each artifact and returns fetchable URLs', async () => {
    const put = vi
      .fn()
      .mockImplementation(async (path: string) => ({ url: `https://blob.test/${path}` }));
    const store = new BlobArtifactStore(put);

    const result = await store.upload('req-1', await fixtureArtifacts());

    expect(put).toHaveBeenCalledTimes(3);
    expect(result.screenshotUrl).toContain('dashboard.png');
    expect(result.domSnapshotUrl).toContain('dashboard.html');
    expect(result.axTreeUrl).toContain('dashboard.ax.json');
  });

  it('uploads evidence privately, never publicly', async () => {
    // This is a screenshot of a *signed-in* page on a client's system, so it
    // holds whatever real end-user data was on screen. A public blob is
    // readable by anyone holding its URL — and these URLs are stored in our
    // database and travel through logs, which would make "nobody will guess
    // it" the only thing protecting a client's authenticated screens.
    const put = vi.fn().mockResolvedValue({ url: 'https://blob.test/x' });
    const store = new BlobArtifactStore(put);

    await store.upload('req-1', await fixtureArtifacts());

    expect(put).toHaveBeenCalled();
    for (const call of put.mock.calls) {
      expect(call[2].access).toBe('private');
    }
  });

  it('makes URLs unguessable so a requestId does not enumerate evidence', async () => {
    const put = vi.fn().mockResolvedValue({ url: 'https://blob.test/x' });
    const store = new BlobArtifactStore(put);

    await store.upload('req-1', await fixtureArtifacts());

    for (const call of put.mock.calls) {
      expect(call[2].addRandomSuffix).toBe(true);
    }
  });

  it('scopes the path to the run', async () => {
    const put = vi.fn().mockResolvedValue({ url: 'https://blob.test/x' });
    const store = new BlobArtifactStore(put);

    await store.upload('req-abc', await fixtureArtifacts());

    expect(put.mock.calls.every((call) => call[0].startsWith('runs/req-abc/'))).toBe(true);
  });

  it('scopes each page of a multi-page run to its own path', async () => {
    // Every audited page captures a screenshot, a DOM snapshot and an AX tree.
    // Without the page in the path they all compete for the same three keys.
    const put = vi.fn().mockResolvedValue({ url: 'https://blob.test/x' });
    const store = new BlobArtifactStore(put);

    await store.upload('req-abc', await fixtureArtifacts(), '02-checkout');

    expect(put.mock.calls.every((call) => call[0].startsWith('runs/req-abc/02-checkout/'))).toBe(
      true,
    );
  });

  it('sets a content type so evidence renders rather than downloads', async () => {
    const put = vi.fn().mockResolvedValue({ url: 'https://blob.test/x' });
    const store = new BlobArtifactStore(put);

    await store.upload('req-1', await fixtureArtifacts());

    const types = put.mock.calls.map((call) => call[2].contentType);
    expect(types).toContain('image/png');
    expect(types).toContain('text/html; charset=utf-8');
    expect(types).toContain('application/json');
  });

  it('uploads only the artifacts a degraded run produced', async () => {
    // An omitted ax tree must not become a failed upload.
    const put = vi.fn().mockResolvedValue({ url: 'https://blob.test/x' });
    const store = new BlobArtifactStore(put);
    const { screenshotPath, domSnapshotPath } = await fixtureArtifacts();

    const result = await store.upload('req-1', { screenshotPath, domSnapshotPath });

    expect(put).toHaveBeenCalledTimes(2);
    expect(result.axTreeUrl).toBeUndefined();
  });
});

describe('NoopArtifactStore', () => {
  it('returns nothing, for local runs where the files are already reachable', async () => {
    expect(await new NoopArtifactStore().upload()).toEqual({});
  });
});
