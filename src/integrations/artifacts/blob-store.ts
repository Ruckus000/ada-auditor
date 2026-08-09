import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ArtifactStore, StoredArtifacts } from '../../domain/artifacts';
import type { JourneyArtifacts } from '../browser/types';

/**
 * Uploads run evidence to Vercel Blob and returns fetchable URLs.
 *
 * Artifacts were previously written to the function's local disk and left
 * there: no route served them, no run record referenced them, and on
 * serverless the filesystem is gone when the invocation ends. So the screenshot
 * and DOM proving a finding were unreachable by the person the finding was
 * for — which makes "evidence-first" a claim rather than a property.
 *
 * ## Retention
 *
 * These are screenshots and DOM snapshots of authenticated pages on client
 * systems. They contain whatever real end users had on screen. They are stored
 * private, addressed by an unguessable path, and swept after
 * `ARTIFACT_RETENTION_DAYS` (default 30) by `scripts/prune-artifacts.ts`.
 * Retention is a property of the feature, not a follow-up.
 */

const DEFAULT_RETENTION_DAYS = 30;

export function retentionDays(): number {
  const configured = Number(process.env.ARTIFACT_RETENTION_DAYS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS;
}

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

type PutFn = (
  path: string,
  body: Buffer,
  options: { access: 'public'; addRandomSuffix: boolean; contentType?: string },
) => Promise<{ url: string }>;

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
};

function contentTypeFor(path: string): string | undefined {
  const extension = Object.keys(CONTENT_TYPES).find((suffix) => path.endsWith(suffix));
  return extension ? CONTENT_TYPES[extension] : undefined;
}

export class BlobArtifactStore implements ArtifactStore {
  constructor(private readonly put: PutFn) {}

  async upload(
    requestId: string,
    artifacts: JourneyArtifacts,
    pageKey?: string,
  ): Promise<StoredArtifacts> {
    const entries = Object.entries(artifacts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );

    const uploaded: StoredArtifacts = {};
    // One directory per audited page, so a multi-page run's evidence does not
    // overwrite itself.
    const prefix = pageKey ? `runs/${requestId}/${pageKey}` : `runs/${requestId}`;

    for (const [kind, localPath] of entries) {
      const body = await readFile(localPath);
      // `addRandomSuffix` makes the URL unguessable, so knowing a requestId is
      // not enough to enumerate another run's evidence.
      const { url } = await this.put(`${prefix}/${basename(localPath)}`, body, {
        access: 'public',
        addRandomSuffix: true,
        contentType: contentTypeFor(localPath),
      });

      // screenshotPath -> screenshotUrl, and so on.
      uploaded[kind.replace(/Path$/, 'Url') as keyof StoredArtifacts] = url;
    }

    return uploaded;
  }
}

/**
 * Used when no blob store is configured — local development and CI, where the
 * artifacts on disk are already reachable and re-uploading them is pure cost.
 */
export class NoopArtifactStore implements ArtifactStore {
  async upload(): Promise<StoredArtifacts> {
    return {};
  }
}

let store: ArtifactStore | undefined;

export function getArtifactStore(): ArtifactStore {
  if (!store) {
    store = isBlobConfigured()
      ? new BlobArtifactStore(async (path, body, options) => {
          const { put } = await import('@vercel/blob');
          return put(path, body, options);
        })
      : new NoopArtifactStore();
  }
  return store;
}

/** Test seam. */
export function setArtifactStore(next: ArtifactStore | undefined): void {
  store = next;
}
