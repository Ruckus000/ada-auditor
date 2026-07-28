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
