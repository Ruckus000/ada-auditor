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
  upload(requestId: string, artifacts: JourneyArtifacts): Promise<StoredArtifacts>;
}
