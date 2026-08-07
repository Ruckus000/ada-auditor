import { z } from 'zod';

export const environmentSchema = z.enum(['production', 'preview', 'staging', 'test']);

export const platformSchema = z.enum(['generic', 'react', 'wordpress']);

export const platformCapabilitiesSchema = z.object({
  spaNavigationHints: z.boolean(),
  componentSourceHints: z.boolean(),
  cmsTemplateHints: z.boolean(),
});

export const runContractSchema = z.object({
  environment: environmentSchema,
  identity: z.object({
    accountId: z.string().min(1),
    role: z.string().min(1),
  }),
  scope: z.object({
    /**
     * Hosts the run may navigate to. Empty means none — the correct scope for
     * a run against local `file://` fixtures, which reaches no network at all.
     * It fails closed rather than open: `assertAllowedUrl` rejects every URL
     * when the list is empty, so an empty scope can never widen access.
     */
    allowedDomains: z.array(z.string().min(1)),
    journeyIds: z.array(z.string().min(1)).min(1),
  }),
  actionPolicy: z.object({
    mode: z.enum(['read-only', 'safe-write', 'test-full']),
  }),
  recoveryPolicy: z.object({
    maxAttempts: z.number().int().min(0),
    strategies: z.array(z.string().min(1)),
  }),
  confidencePolicy: z.object({
    minContinue: z.number().min(0).max(1),
    minReport: z.number().min(0).max(1),
  }),
  failureMode: z.enum(['stop', 'degrade', 'warn']),
  platform: platformSchema.optional(),
  platformCapabilities: platformCapabilitiesSchema.optional(),
});

export type Environment = z.infer<typeof environmentSchema>;
export type RunContract = z.infer<typeof runContractSchema>;

export function createRunContract(input: RunContract): RunContract {
  return runContractSchema.parse(input);
}
