import { MIN_TOKEN_LENGTH } from '../_lib/console-session';
import { isThrottleKvConfigured } from '../_lib/unlock-throttle';
import { isDatabaseConfigured } from '../../../integrations/persistence';
import { sessionSecretIsShared } from '../_lib/principal';

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
 */
export async function GET() {
  const token = process.env.AUDITOR_RUN_TOKEN;

  const checks = {
    auditorRunTokenConfigured: typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH,
    runStoreConfigured: isDatabaseConfigured(),
    unlockThrottleDurable: isThrottleKvConfigured(),
    sessionSecretDedicated: !sessionSecretIsShared(),
    chaosEnabled: process.env.CHAOS_ENABLED === 'true',
  };

  const ready = checks.auditorRunTokenConfigured && checks.runStoreConfigured;

  const warnings: string[] = [];

  if (!checks.unlockThrottleDurable) {
    warnings.push(
      'unlock_throttle_in_memory: no Redis configured, so console sign-in attempts are counted per instance and reset on cold start.',
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
