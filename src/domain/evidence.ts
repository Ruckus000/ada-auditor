import { z } from 'zod';
import { environmentSchema } from './contracts';

const evidenceInputSchema = z.object({
  page: z.object({
    url: z.url(),
    route: z.string().min(1),
    /**
     * Allowed to be empty, and that is the point.
     *
     * This was `.min(1)`, and `createEvidenceBundle` parses rather than
     * safe-parses, so a page whose `document.title` came back empty threw and
     * took the whole run with it — every other page's findings lost with it.
     *
     * An empty title is not a capture failure. It is a page, and a page with
     * no title is a WCAG 2.4.2 failure that axe reports as `document-title`.
     * Refusing to record it meant the auditor died on the exact defect it
     * exists to find, and reported nothing at all instead of reporting that.
     *
     * It is not part of evidence completeness either: `status` below is about
     * whether the three artifacts were written. Degrading the page would have
     * discarded its findings — including the missing title itself.
     */
    title: z.string(),
  }),
  run: z.object({
    journeyId: z.string().min(1),
    stepId: z.string().min(1),
    environment: environmentSchema,
  }),
  artifacts: z.object({
    screenshotPath: z.string().min(1).optional(),
    domSnapshotPath: z.string().min(1).optional(),
    axTreePath: z.string().min(1).optional(),
  }),
});

export type EvidenceBundleInput = z.infer<typeof evidenceInputSchema>;
export type EvidenceStatus = 'complete' | 'degraded';

export type EvidenceBundle = EvidenceBundleInput & {
  status: EvidenceStatus;
};

export function createEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle {
  const parsed = evidenceInputSchema.parse(input);
  const complete = Boolean(
    parsed.artifacts.screenshotPath &&
      parsed.artifacts.domSnapshotPath &&
      parsed.artifacts.axTreePath,
  );

  return {
    ...parsed,
    status: complete ? 'complete' : 'degraded',
  };
}

/**
 * A run's evidence status is the worst of its pages'.
 *
 * A run now audits every page a journey walks through, and each page has its
 * own evidence. One page missing an artifact is enough to make the run's
 * verdict unsafe, so the run takes the worst status rather than an average or
 * the last page's — the steady-state rule (incomplete evidence is never `pass`
 * and never `fail`) has to survive the page dimension unchanged.
 *
 * A run with no pages at all is `degraded`: nothing was captured, so nothing
 * can be judged.
 */
export function worstEvidenceStatus(statuses: EvidenceStatus[]): EvidenceStatus {
  if (statuses.length === 0) {
    return 'degraded';
  }
  return statuses.every((status) => status === 'complete') ? 'complete' : 'degraded';
}
