import { z } from 'zod';
import { environmentSchema } from './contracts';

const evidenceInputSchema = z.object({
  page: z.object({
    url: z.url(),
    route: z.string().min(1),
    title: z.string().min(1),
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
