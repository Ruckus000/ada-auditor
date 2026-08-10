import type { JourneyArtifacts } from '../integrations/browser/types';

/**
 * Durable locations of a run's evidence.
 *
 * These sit on the stored run record so a finding can always be traced back to
 * the screenshot and DOM it came from — including from a client report, long
 * after the function that produced them is gone.
 */
export type StoredArtifacts = {
  screenshotUrl?: string;
  domSnapshotUrl?: string;
  axTreeUrl?: string;
};

/**
 * What a read of stored evidence produced.
 *
 * `pruned` is not `missing`. Evidence is deleted on a retention schedule, so a
 * blob that is gone after thirty days is the system working — and telling an
 * operator "not found" for that would send them looking for a bug. They are
 * different facts and the route reports them differently.
 */
export type ArtifactRead =
  | { status: 'ok'; contentType: string; body: ReadableStream<Uint8Array> }
  | { status: 'pruned' };

export interface ArtifactStore {
  /**
   * `pageKey` scopes one page's evidence within a run. A run audits every page
   * its journey walks through, and each captures a screenshot, a DOM snapshot
   * and an AX tree — without the page in the path they would all compete for
   * the same three keys.
   */
  upload(
    requestId: string,
    artifacts: JourneyArtifacts,
    pageKey?: string,
  ): Promise<StoredArtifacts>;
  /**
   * Streams one stored artifact back.
   *
   * Takes the URL the store itself produced, never one a caller supplied — the
   * route reads it out of the run record for exactly that reason. `upload`
   * uses `addRandomSuffix`, so the stored URL is the only handle in existence
   * and the database read is mandatory rather than an optimisation. That
   * constraint is also what makes this safe: there is no caller-controlled
   * string anywhere in the path, so no request-forgery surface.
   */
  read(url: string): Promise<ArtifactRead>;
}
