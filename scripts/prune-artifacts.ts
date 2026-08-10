import { del, list } from '@vercel/blob';
import { retentionDays } from '../src/integrations/artifacts/blob-store';
import { logInfo } from '../src/services/logger';

/**
 * Deletes run evidence past its retention window.
 *
 * Audit artifacts are screenshots and DOM snapshots of authenticated pages on
 * client systems — they contain whatever real end users had on screen. Keeping
 * them forever is a liability that grows on its own, so this runs on a schedule
 * (see `.github/workflows/prune-artifacts.yml`) rather than being something
 * someone remembers to do.
 */
async function main(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('PRUNE FAIL: BLOB_READ_WRITE_TOKEN is not set.');
    process.exit(1);
  }

  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;

  do {
    const page = await list({ prefix: 'runs/', cursor, limit: 1000 });

    const expired = page.blobs.filter((blob) => new Date(blob.uploadedAt) < cutoff);
    scanned += page.blobs.length;

    if (expired.length > 0) {
      await del(expired.map((blob) => blob.url));
      deleted += expired.length;
    }

    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  logInfo('artifact_prune', {
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    scanned,
    deleted,
  });
}

main().catch((error) => {
  console.error(`PRUNE FAIL: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
