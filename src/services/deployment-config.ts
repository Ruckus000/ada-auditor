import { discoveryBudgetLimits, documentBudgetLimits, runBudgetLimits } from './run-budget';
import { DEFAULT_RETENTION_DAYS } from '../integrations/artifacts/blob-store';
import {
  DEFAULT_MAX_PAGES_PER_RUN,
  DEFAULT_WALK_BUDGET_MS,
  positiveIntFrom,
} from '../domain/run-limits';

/**
 * What this deployment is actually configured to do.
 *
 * The settings screen this replaces had nine hundred lines of controls: scan
 * schedules, notification rules, WCAG level pickers, seat management, SSO. Not
 * one of them was wired to anything, and most described features that did not
 * exist. Two since do: runs are scheduled and operators are real people, and
 * both appear below as settings that report rather than controls that pretend.
 * Notifications and seats remain fiction, and so remain absent.
 *
 * What an operator can genuinely ask is "what is this deployment doing, and
 * what is degraded". That is environment configuration, so the screen shows it
 * and says where each answer comes from. Everything here is read-only on
 * purpose: these are deploy-time settings, and a form that appeared to change
 * them from a web page would be lying about where the truth lives.
 */

export type ConfigSetting = {
  key: string;
  label: string;
  /** Present, absent, or a value safe to display. Never a secret. */
  value: string;
  detail: string;
  /** True when the current state weakens something. Drives the warning list. */
  degraded: boolean;
};

export type DeploymentConfig = {
  settings: ConfigSetting[];
  degradedCount: number;
};

/** Just the shape this module reads, so a test can pass four keys. */
export type Env = Record<string, string | undefined>;

/**
 * Facts that are not environment variables.
 *
 * Whether a JVM and the compiled document stages exist is a question about the
 * filesystem, and answering it means calling into `integrations/documents`.
 * Nothing in `services/` imports an integration — that is the layering, and it
 * is what keeps this module in the fast unit suite — so the caller resolves it
 * and passes it down.
 *
 * Defaulting to `false` is deliberate: an unanswered question renders as "not
 * available here", which is the truth on every deployment that has not gone out
 * of its way to install one.
 */
export type DeploymentFacts = {
  /** A JVM and the compiled PDF stages. */
  documentToolchainAvailable?: boolean;
  /** LibreOffice, for converting Word sources. */
  documentConverterAvailable?: boolean;
};

/**
 * Reads a positive integer env var, falling back rather than throwing.
 *
 * `positiveIntFrom` rather than a local parser. The local one demanded
 * `Number.isInteger`, so `AUDITOR_MAX_PAGES_PER_RUN=20.0` read as unset on the
 * one screen whose stated purpose is to say what this deployment is configured
 * to do — while the runner floored the same value and honoured it.
 */
function intFromEnv(env: Env, name: string, fallback: number): number {
  return positiveIntFrom(env[name], fallback);
}

/**
 * Two independent capabilities, reported as one line an operator can act on.
 *
 * The PDF stages need a JVM; converting a Word source additionally needs
 * LibreOffice. Naming which half is missing is the difference between a person
 * installing the right thing and a person guessing.
 */
function documentCapability(facts: DeploymentFacts): string {
  if (facts.documentToolchainAvailable && facts.documentConverterAvailable) return 'available';
  if (facts.documentToolchainAvailable) return 'PDF stages only';
  if (facts.documentConverterAvailable) return 'converter only';
  return 'not available here';
}

function documentDetail(facts: DeploymentFacts): string {
  const missing: string[] = [];
  if (!facts.documentToolchainAvailable) missing.push('a JDK 17+ and `npm run build:documents`');
  if (!facts.documentConverterAvailable) missing.push('LibreOffice');

  if (missing.length === 0) {
    return 'A Java runtime and LibreOffice are both present, so Word sources can be converted and PDFs inspected on this host.';
  }

  return `Document stages run on a JVM and the source path needs LibreOffice; a serverless function has neither, so this is expected on a deployed environment rather than a fault, and nothing else is affected by it. Where it is wanted, install: ${missing.join(' and ')}.`;
}

/**
 * Mirrors `passkeyRelyingPartyStatus` in `api/_lib/principal.ts`, over the
 * `env` this module is handed rather than `process.env` — services take their
 * environment as a parameter so a test can pass four keys, and importing the
 * API helper would point this module at the wrong one.
 */
function passkeyConfigValue(env: Env): 'available' | 'off' | 'misconfigured' {
  const id = env.AUDITOR_RP_ID?.trim();
  const origin = env.AUDITOR_RP_ORIGIN?.trim();

  if (!id && !origin) return 'off';
  if (!id || !origin) return 'misconfigured';

  try {
    const host = new URL(origin).hostname;
    return host === id || host.endsWith(`.${id}`) ? 'available' : 'misconfigured';
  } catch {
    return 'misconfigured';
  }
}

function passkeyConfigDetail(env: Env): string {
  switch (passkeyConfigValue(env)) {
    case 'available':
      return 'AUDITOR_RP_ID and AUDITOR_RP_ORIGIN. Operators can sign in with a device instead of a password; passwords keep working, and remain the way back in if every device is lost.';
    case 'misconfigured':
      return 'Both variables are set but they do not agree, so passkeys are unavailable and the deployment cannot tell you that anywhere else. AUDITOR_RP_ORIGIN needs a scheme (https://console.example.com); AUDITOR_RP_ID is that origin\'s hostname or a parent of it, with no scheme and no path. `/api/ready` names which half is wrong.';
    default:
      return 'No AUDITOR_RP_ID / AUDITOR_RP_ORIGIN, so passkeys are unavailable and everyone signs in with a password. Both values are configuration by necessity — a relying party taken from a request header would let an attacker mint credentials against a domain they control.';
  }
}

export function readDeploymentConfig(
  env: Env = process.env,
  facts: DeploymentFacts = {},
): DeploymentConfig {
  const budget = runBudgetLimits(env);
  const documents = documentBudgetLimits(env);
  const discovery = discoveryBudgetLimits(env);
  const countersDurable = Boolean(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL);

  const settings: ConfigSetting[] = [
    {
      key: 'operator',
      label: 'Automation name',
      value: env.AUDITOR_OPERATOR_NAME?.trim() || 'Operator',
      detail:
        'What activity is attributed to when the caller is a machine rather than a person — CI, a script, the scheduler. People sign in with their own accounts and are recorded under their own names.',
      degraded: false,
    },
    {
      key: 'sessionSecret',
      label: 'Session signing key',
      value: env.AUDITOR_SESSION_SECRET?.trim() ? 'dedicated' : 'shared with the run token',
      detail: env.AUDITOR_SESSION_SECRET?.trim()
        ? 'AUDITOR_SESSION_SECRET. Rotating it signs every operator out, which is the deliberate "log everyone out" lever; rotating the run token no longer does.'
        : 'No AUDITOR_SESSION_SECRET, so operator sessions are signed with AUDITOR_RUN_TOKEN. Rotating the machine token therefore still signs every human out — the exact coupling operator accounts exist to break. Set a separate value.',
      degraded: !env.AUDITOR_SESSION_SECRET?.trim(),
    },
    {
      key: 'passkeys',
      label: 'Passkey sign-in',
      value: passkeyConfigValue(env),
      detail: passkeyConfigDetail(env),
      // `off` is not degraded — password sign-in is a supported way to run,
      // and previews and local development are *expected* to have this off,
      // since a credential is bound to one origin. `misconfigured` is: both
      // variables are set, the deploy believes passkeys are on, and they are
      // not. That is the state worth a flag, and it used to read as `off`.
      degraded: passkeyConfigValue(env) === 'misconfigured',
    },
    {
      key: 'database',
      label: 'Run store',
      value: env.AUDITOR_STORE === 'memory' ? 'in memory' : env.DATABASE_URL ? 'Postgres' : 'not configured',
      detail:
        env.AUDITOR_STORE === 'memory'
          ? 'AUDITOR_STORE=memory. Nothing is persisted, and nothing should be running this way outside a test harness.'
          : 'Neon Postgres. There is no filesystem fallback: one would mean a misconfigured deploy quietly writing runs to a disk that disappears with the invocation.',
      degraded: env.AUDITOR_STORE === 'memory' || !env.DATABASE_URL,
    },
    {
      key: 'blob',
      label: 'Evidence storage',
      value: env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : 'local disk',
      detail:
        'Screenshots, DOM snapshots and accessibility trees. On serverless the local filesystem disappears with the invocation, so evidence written there is unreachable afterwards.',
      degraded: !env.BLOB_READ_WRITE_TOKEN,
    },
    {
      key: 'runBudget',
      label: 'Run budget',
      value: `${budget.perHour}/hour, ${budget.perDay}/day`,
      detail:
        (countersDurable
          ? 'Counted in Redis, so the ceiling holds across instances. '
          : 'Counted in process memory, so each serverless instance has its own counter and the effective ceiling is this limit times however many are warm. ') +
        'A run launches a browser and makes a model call; without a ceiling a loop in a caller spends real money unattended. It fails open — a cost control that becomes an outage has made things worse.',
      degraded: !countersDurable,
    },
    {
      key: 'documentBudget',
      label: 'Document budget',
      value: `${documents.perHour}/hour, ${documents.perDay}/day`,
      detail:
        (countersDurable
          ? 'Counted in Redis, so the ceiling holds across instances. '
          : 'Counted in process memory, so each serverless instance has its own counter and the effective ceiling is this limit times however many are warm. ') +
        'Every inspection, conversion, repair and intake launches a JVM — and a converter for Word — on a function that may run five minutes; this bounds what a looping caller or a leaked token can spend. Its own ceiling, so an inventory sweep cannot spend the audits a client bought. Fails open the same way.',
      degraded: !countersDurable,
    },
    {
      key: 'discoveryBudget',
      label: 'Discovery budget',
      value: `${discovery.perHour}/hour, ${discovery.perDay}/day`,
      detail:
        (countersDurable
          ? 'Counted in Redis, so the ceiling holds across instances. '
          : 'Counted in process memory, so each serverless instance has its own counter and the effective ceiling is this limit times however many are warm. ') +
        'A discovery crawl is a browser walking up to a hundred pages for up to a minute. Its own ceiling rather than a share of the run budget, so picking pages cannot spend the audits a client bought. Fails open the same way.',
      degraded: !countersDurable,
    },
    {
      key: 'throttle',
      label: 'Unlock throttle',
      value:
        env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL ? 'durable (Redis)' : 'in process memory',
      detail:
        'Counts failed console unlock attempts. Without Redis it is per-instance and resets on every cold start — a speed bump rather than a limit. The real defence is a high-entropy token.',
      degraded: !(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL),
    },
    {
      key: 'advisory',
      label: 'AI advisory pass',
      // Three states, and the two offs are different facts: `off (by
      // configuration)` is a decision this deployment made; `off (unreachable)`
      // is a deployment that cannot reach the gateway at all. Conflating them
      // would send an operator hunting for a missing key that was never the
      // reason.
      value:
        (env.AUDITOR_ADVISORY_MODEL ?? '').trim().toLowerCase() === 'off'
          ? 'off (by configuration)'
          : env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN
            ? 'on'
            : 'off (unreachable)',
      detail:
        'Judges what a rule engine cannot — alt text that says nothing, headings used for size. Runs through the Vercel AI Gateway, so the model is the `AUDITOR_ADVISORY_MODEL` string rather than a vendor SDK, and a Vercel deployment authenticates with the OIDC token it mints for itself; setting the model to `off` disables the pass outright. Advisory findings never gate a build, and their absence is never a run failure.',
      degraded: false,
    },
    {
      key: 'documents',
      label: 'Document remediation',
      value: documentCapability(facts),
      detail: documentDetail(facts),
      // Never degraded. Absence is the design of this slice, not a weakness,
      // and marking it degraded would put a permanent entry in the operator's
      // warning count for a feature that was never promised here.
      degraded: false,
    },
    {
      key: 'schedule',
      label: 'Scheduled runs',
      value: env.CRON_SECRET ? 'hourly tick' : 'not configured',
      detail: env.CRON_SECRET
        ? 'Vercel Cron calls /api/cron/tick hourly. It claims the journeys due this hour and dispatches each to its own invocation — it does not audit anything itself, because one function cannot walk several journeys through a browser.'
        : 'No CRON_SECRET, so the tick refuses every request and any schedule set on a journey never fires. Set it in the Vercel project; Vercel sends it as a bearer token.',
      degraded: !env.CRON_SECRET,
    },
    {
      key: 'pageCap',
      label: 'Pages per run',
      value: String(intFromEnv(env, 'AUDITOR_MAX_PAGES_PER_RUN', DEFAULT_MAX_PAGES_PER_RUN)),
      detail:
        'The second of two bounds on a walk, and the one that stops a site with many small pages. A journey longer than this is truncated and the run says which bound did it. The default has one measurement behind it — four static pages cost 4.0s each at their slowest on a production function, so twenty is roughly 80s of a 300s ceiling — but nothing has measured a real client app, which renders more and waits longer. If real journeys exceed it, that is the signal for a container worker rather than a bigger number.',
      degraded: false,
    },
    {
      key: 'walkBudget',
      label: 'Walk budget',
      value: `${intFromEnv(env, 'AUDITOR_WALK_BUDGET_MS', DEFAULT_WALK_BUDGET_MS) / 1000}s`,
      detail:
        'The first of two bounds on a walk, and the one that stops a slow site. It bounds when the walk starts new work, never when work already in flight finishes — so keep it comfortably above `AUDITOR_EXPECT_TIMEOUT_MS`, which is how long the page still being audited may take. What is left of the 300s function ceiling after this is the reserve for upload, advisory and persistence.',
      degraded: false,
    },
    {
      key: 'retention',
      label: 'Evidence retention',
      value: `${intFromEnv(env, 'ARTIFACT_RETENTION_DAYS', DEFAULT_RETENTION_DAYS)} days`,
      detail:
        'Screenshots of authenticated pages on client systems contain real end-user data, so `npm run prune:artifacts` sweeps anything older.',
      degraded: false,
    },
    {
      key: 'chaos',
      label: 'Chaos injection',
      value: env.CHAOS_ENABLED === 'true' ? 'enabled' : 'disabled',
      detail:
        'Lets a run be asked for a scripted outcome. Fine in preview and in the test harness; a production deployment accepting scripted audit results is not fine.',
      degraded: env.CHAOS_ENABLED === 'true',
    },
  ];

  return { settings, degradedCount: settings.filter((setting) => setting.degraded).length };
}
