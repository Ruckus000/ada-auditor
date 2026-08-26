import { MIN_TOKEN_LENGTH } from '../_lib/console-session';
import { createRedisClient } from '../_lib/redis';
import { isThrottleKvConfigured, KvThrottleStore } from '../_lib/unlock-throttle';
import { isDatabaseConfigured } from '../../../integrations/persistence';
import { sessionSecretIsShared } from '../_lib/principal';
import { isBlobConfigured } from '../../../integrations/artifacts/blob-store';
import { isAiAdvisoryConfigured } from '../../../services/ai-advisory';
import { isDocumentToolchainAvailable } from '../../../integrations/documents/java-runtime';

/**
 * Deploy-time readiness.
 *
 * The distinction below is the whole point of this route. A check that gates
 * readiness is one where the control plane cannot do its job at all; anything
 * else is reported but does not take the deployment down, because a security
 * speed bump degrading is not a reason to serve 503 to everyone.
 *
 * `runStoreConfigured` gates. `createRunStore()` throws without `DATABASE_URL`,
 * which fails closed — but it fails on the first audit someone tries, long
 * after the deploy that broke it. Reporting it here is what turns a runtime
 * surprise into a deploy-time one.
 *
 * `unlockThrottleDurable` does not gate. Redis used to be required because the
 * run store needed it; the run store is Postgres now, so nothing else forces
 * Upstash to exist and a deploy can reach production with the console unlock
 * throttle counting attempts in process memory — per-instance, reset on every
 * cold start. That is a real weakness and it should be visible, but it is not
 * an outage.
 *
 * `unlockThrottleReachable` is *asked*, not inferred from configuration. The
 * two came apart in production: the variables were set, so this endpoint said
 * `ready` with an empty `warnings` array, while the Upstash host they named had
 * stopped resolving and every sign-in returned 500. A readiness check that only
 * reads its own configuration cannot tell "pointed at Redis" from "pointed at
 * Redis that answers", and it is the second one that matters.
 */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Does the throttle store actually answer?
 *
 * A read, never a write — asking must not count as a failed attempt against
 * whoever owns this key. `getThrottleStore` returns the resilient wrapper,
 * which swallows the error and falls back, so the probe goes at the underlying
 * store: the question here is whether the durable one is alive, and the
 * wrapper is designed to hide exactly that.
 */
async function throttleAnswers(): Promise<boolean> {
  if (!isThrottleKvConfigured()) {
    // Memory always answers. Reporting `true` would make an unconfigured
    // deployment look healthier than a misconfigured one; the separate
    // `unlockThrottleDurable` check is what describes this case.
    return false;
  }

  // Bounded twice: no client-side retries, and a wall-clock ceiling for a host
  // that accepts the connection and never answers. Unbounded, this endpoint
  // would hang for as long as the platform allows — and the console banner
  // polls it, so the operator would see a dead control plane rather than the
  // warning this check exists to raise.
  const timeout = new Promise<false>((resolve) => {
    setTimeout(() => resolve(false), PROBE_TIMEOUT_MS).unref?.();
  });

  const probe = (async () => {
    try {
      await new KvThrottleStore(createRedisClient({ retries: 0 })).isThrottled('readiness-probe');
      return true;
    } catch {
      return false;
    }
  })();

  return Promise.race([probe, timeout]);
}

export async function GET() {
  const token = process.env.AUDITOR_RUN_TOKEN;

  const checks = {
    auditorRunTokenConfigured: typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH,
    runStoreConfigured: isDatabaseConfigured(),
    unlockThrottleDurable: isThrottleKvConfigured(),
    unlockThrottleReachable: await throttleAnswers(),
    sessionSecretDedicated: !sessionSecretIsShared(),
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    blobConfigured: isBlobConfigured(),
    advisoryConfigured: isAiAdvisoryConfigured(),
    documentToolchainAvailable: isDocumentToolchainAvailable(),
    chaosEnabled: process.env.CHAOS_ENABLED === 'true',
  };

  const ready = checks.auditorRunTokenConfigured && checks.runStoreConfigured;

  const warnings: string[] = [];

  // Not gating: the throttle degrades to memory rather than failing, so a
  // dead Redis is no longer an outage. It is still a hole — the limit becomes
  // per-instance — and the operator is the only one who can fix it.
  if (checks.unlockThrottleDurable && !checks.unlockThrottleReachable) {
    warnings.push(
      'unlock_throttle_unreachable: a Redis endpoint is configured but did not answer, so sign-in attempts are being counted per instance. Check KV_REST_API_URL still points at a live store.',
    );
  }

  if (!checks.unlockThrottleDurable) {
    warnings.push(
      'counters_in_memory: no Redis configured, so console sign-in attempts and the run budget are counted per instance and reset on cold start. The effective run ceiling is the limit times however many instances are warm.',
    );
  }

  // Also reported rather than gating: an auditor driven entirely by hand, with
  // nothing scheduled, is a working deployment. What is worth saying is that
  // any schedule an operator sets will not fire.
  if (!checks.cronSecretConfigured) {
    warnings.push(
      'cron_secret_not_configured: no CRON_SECRET, so the scheduled-run tick refuses every request and journey schedules never fire.',
    );
  }

  // Reported, not gating — and gating would be wrong. A deployment with no
  // operator accounts at all, driven entirely by CI with the run token, is
  // working. What is degraded is that the two secrets are the same value, so
  // rotating the machine token still signs every human out, which is the exact
  // coupling operator accounts exist to break.
  if (!checks.sessionSecretDedicated) {
    warnings.push(
      'session_secret_shared_with_run_token: no AUDITOR_SESSION_SECRET, so operator sessions are signed with AUDITOR_RUN_TOKEN and rotating it signs everyone out.',
    );
  }

  /**
   * Evidence with nowhere to go, which is the one degradation that reaches a
   * client's report.
   *
   * `createEvidenceBundle` decides a page is complete from the *local*
   * artifact paths, and the runner always writes those. Without a token
   * `getArtifactStore()` returns the no-op store, so nothing is uploaded and
   * no URL is recorded — and the run still reports `evidenceStatus:
   * 'complete'` while every later read answers `pruned`. An upload that
   * *fails* correctly fails the run; an absent store does not, so this warning
   * is the only thing standing between a missing token and a conformance
   * document whose evidence cannot be produced.
   *
   * Reported rather than gating, like the rest: a control plane writing to
   * local disk still works, and 503 over it would be worse than the gap.
   */
  if (!checks.blobConfigured) {
    warnings.push(
      'evidence_storage_not_configured: no BLOB_READ_WRITE_TOKEN, so run evidence is written to a filesystem that disappears with the invocation. Runs will still report complete evidence, and reading it back will answer 410.',
    );
  }

  // `advisoryConfigured` is reported and deliberately never warned about. It
  // is off by decision, and a warnings array with a permanent entry is one
  // people stop reading — which is how the retention sweep failed eleven
  // nights unnoticed. `chaosEnabled` sets the same precedent: a plain check
  // that gates nothing until it is actually wrong.
  //
  // `documentToolchainAvailable` follows that rule and is the strongest case
  // for it. Document stages need a JVM, and a Vercel function has none — so on
  // every production deployment this is false, permanently and by design. A
  // warning here would not describe a problem, it would put an entry in the
  // array that never clears, and the deploy checklist tells an operator to look
  // for that array being empty. Reported in `checks`, explained in the settings
  // screen, and silent here.

  // The deploy checklist tells an operator to look for an empty warnings
  // array, so anything that makes results untrustworthy has to appear in it.
  // Chaos was reported in `checks` and nowhere else, which meant a production
  // deployment able to serve scripted audit outcomes passed the checklist.
  if (checks.chaosEnabled) {
    warnings.push(
      'chaos_enabled: CHAOS_ENABLED is set, so callers can request scripted audit outcomes. This must not be set in production.',
    );
  }

  return Response.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks,
      warnings,
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
