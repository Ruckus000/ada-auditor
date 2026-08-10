import { del, list } from '@vercel/blob';
import { retentionDays } from '../src/integrations/artifacts/blob-store';
import { logInfo } from '../src/services/logger';
import { getRunStore } from '../src/integrations/persistence';
import { loadEnvLocal } from './load-env';

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
  loadEnvLocal();

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

  /**
   * Clear the pointers after the bytes, never before.
   *
   * The reverse order would strand blobs with no record of where they came
   * from — nothing else knows those URLs. This way a crash between the two
   * leaves URLs pointing at deleted blobs, which the read route already
   * reports as `evidence_pruned`, and the next run of this script tidies up.
   *
   * Until now this step did not exist at all: the blobs went and the database
   * kept URLs that 404 forever, with nothing to say why.
   */
  let clearedPages = 0;
  if (process.env.DATABASE_URL) {
    clearedPages = await getRunStore().clearArtifactsBefore(cutoff.toISOString());
  }

  logInfo('artifact_prune', {
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    scanned,
    deleted,
    clearedPages,
    // Said explicitly, because a prune that silently skipped half its job is
    // exactly the shape of problem this script exists to avoid.
    databaseCleared: Boolean(process.env.DATABASE_URL),
  });
}

main().catch((error) => {
  console.error(`PRUNE FAIL: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
