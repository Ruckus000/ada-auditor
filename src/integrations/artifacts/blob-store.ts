import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ArtifactRead, ArtifactStore, StoredArtifacts } from '../../domain/artifacts';
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
 * `ARTIFACT_RETENTION_DAYS` (default 90) by `scripts/prune-artifacts.ts`.
 * Retention is a property of the feature, not a follow-up.
 */

/**
 * Ninety days, and the number is a decision rather than an inheritance.
 *
 * Thirty was shorter than a remediation cycle: a client fixes findings over a
 * quarter, and the evidence behind the report they are working from expired
 * before they finished. Ninety covers that cycle and a quarterly review.
 *
 * Not longer, and the reason is the same one that makes the store private —
 * this is captured end-user data on a client's authenticated pages, and how
 * long it exists is part of what a client is agreeing to. Indefinite retention
 * would need a data-processing agreement behind it, not a default.
 *
 * A default rather than a deployed `ARTIFACT_RETENTION_DAYS`, so the decision
 * is in the repo where it can be read and reviewed, and cannot be forgotten on
 * the next environment.
 */
const DEFAULT_RETENTION_DAYS = 90;

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
  options: { access: 'private'; addRandomSuffix: boolean; contentType?: string },
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
  constructor(
    private readonly put: PutFn,
    private readonly get: GetFn = defaultGet,
  ) {}

  async read(url: string): Promise<ArtifactRead> {
    // Private blobs are not readable by URL alone, which is the point of
    // storing them that way — the token is what authorises this, server-side,
    // and the bytes are streamed rather than the URL handed out. A redirect
    // would give the browser a handle that outlives the session and can be
    // forwarded out of band.
    let result: Awaited<ReturnType<GetFn>>;
    try {
      result = await this.get(url);
    } catch {
      // The SDK throws its own not-found rather than returning null in some
      // versions. Both mean the same thing here, and retention makes that the
      // expected steady state rather than an error.
      return { status: 'pruned' };
    }

    if (!result || result.statusCode !== 200 || !result.stream) {
      return { status: 'pruned' };
    }

    return {
      status: 'ok',
      contentType: result.blob?.contentType ?? 'application/octet-stream',
      body: result.stream,
    };
  }

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
      // Private, not public.
      //
      // This evidence is screenshots and DOM snapshots of *authenticated*
      // pages on a client's system, so it contains whatever real end-user data
      // was on screen. A public blob is readable by anyone holding its URL,
      // and those URLs are stored in our database and travel through logs —
      // which makes "nobody will guess it" the only thing standing between a
      // client's signed-in screens and whoever ends up with the string.
      //
      // `addRandomSuffix` stays, because defence in depth costs nothing here:
      // knowing a requestId must not be enough to name another run's evidence
      // even for a caller that *is* authorised.
      const { url } = await this.put(`${prefix}/${basename(localPath)}`, body, {
        access: 'private',
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
type GetFn = (url: string) => Promise<{
  statusCode: number;
  stream?: ReadableStream<Uint8Array> | null;
  blob?: { contentType?: string };
} | null>;

const defaultGet: GetFn = async (url) => {
  const { get } = await import('@vercel/blob');
  return get(url, { access: 'private' }) as ReturnType<GetFn>;
};

export class NoopArtifactStore implements ArtifactStore {
  async upload(): Promise<StoredArtifacts> {
    return {};
  }

  async read(): Promise<ArtifactRead> {
    return { status: 'pruned' };
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
