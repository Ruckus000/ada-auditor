import type { RunCredentials } from '../../../integrations/browser/credentials';
import type { PlatformStore } from '../../../domain/platform';
import { getPlatformStore } from '../../../integrations/persistence';
import { credentialRefsInSteps } from '../../../services/credential-presence';
import { logWarn } from '../../../services/logger';

/**
 * Builds the `credentials` map a run is handed: what the per-client store
 * holds for the refs this journey's steps name.
 *
 * An *overlay*, never a gate. The map carries only what the store answered;
 * everything else — an unregistered journey, a ref never stored, a store this
 * process cannot reach — falls through to the env-var resolution the runner
 * has always done, and a ref missing from both fails inside the runner with
 * the same `CredentialError` it always has. That is why every failure here
 * degrades to `undefined` with a structured warning instead of failing the
 * run: the fallback may still resolve every ref, and a run that env vars can
 * carry must not die on a lookup it never needed.
 *
 * **The map must never appear in a log line or in the stored run's `intent`.**
 * `intent` stores steps, which carry refs only; the warnings below carry ids
 * and error names, never values. `tests/api/audit-run-credentials.test.ts`
 * greps for exactly this.
 */

/**
 * The store half, shared with the preview route, which already holds the
 * journey and its client. Per-ref failures degrade per ref: a row that no
 * longer decrypts (the key rotated) must not take down the refs beside it,
 * and the env fallback may still carry the one it cost.
 */
export async function storedCredentialsForClient(
  store: Pick<PlatformStore, 'getClientCredentialValues'>,
  clientId: string,
  steps: unknown,
): Promise<RunCredentials | undefined> {
  const refs = credentialRefsInSteps(steps);
  if (refs.length === 0) return undefined;

  const credentials: RunCredentials = {};
  for (const ref of refs) {
    try {
      const values = await store.getClientCredentialValues(clientId, ref);
      if (values) credentials[ref] = values;
    } catch (error) {
      // The ref is presence, not a value; the error name is a class, not a
      // message that could carry one. `CredentialCipherError`'s sentences are
      // constant, but this line deliberately does not trust that.
      logWarn('credential_store_read_failed', {
        clientId,
        ref,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  return Object.keys(credentials).length > 0 ? credentials : undefined;
}

/**
 * The run-handler half. `/api/audit/run` knows a `journeyId` and nothing
 * else, and a journey posted there may not be registered against a client at
 * all — that path has no client, so it has no stored credentials, and the env
 * fallback carries it exactly as it did before the store existed.
 */
export async function storedCredentialsForJourney(
  journeyId: string,
  steps: unknown,
): Promise<RunCredentials | undefined> {
  // Before the store is even constructed: a run with no refs must not pay for
  // — or fail on — a catalog it has no question for.
  if (credentialRefsInSteps(steps).length === 0) return undefined;

  try {
    const platform = getPlatformStore();
    const journey = await platform.getJourney(journeyId);
    if (!journey) return undefined;
    return await storedCredentialsForClient(platform, journey.clientId, steps);
  } catch (error) {
    logWarn('credential_store_lookup_failed', {
      journeyId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return undefined;
  }
}
