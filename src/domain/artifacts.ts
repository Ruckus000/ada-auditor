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
}
