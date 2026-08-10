import { runBudgetLimits } from './run-budget';

/**
 * What this deployment is actually configured to do.
 *
 * The settings screen this replaces had nine hundred lines of controls: scan
 * schedules, notification rules, WCAG level pickers, seat management, SSO. Not
 * one of them was wired to anything, and most described features that do not
 * exist — nothing in this system schedules a run, sends a notification, or has
 * a second user to give a seat to.
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

/** Reads a positive integer env var, falling back rather than throwing. */
function intFromEnv(env: Env, name: string, fallback: number): number {
  const raw = Number(env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

export function readDeploymentConfig(env: Env = process.env): DeploymentConfig {
  const budget = runBudgetLimits(env);
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
      value: env.ANTHROPIC_API_KEY ? 'on' : 'off',
      detail:
        'Judges what a rule engine cannot — alt text that says nothing, headings used for size. Advisory findings never gate a build, and their absence is never a run failure.',
      degraded: false,
    },
    {
      key: 'pageCap',
      label: 'Pages per run',
      value: String(intFromEnv(env, 'AUDITOR_MAX_PAGES_PER_RUN', 20)),
      detail:
        'A journey longer than this is truncated, and the run says so. The default is a guess, not a measurement: if real journeys exceed it, that is the signal for a container worker rather than a bigger number.',
      degraded: false,
    },
    {
      key: 'retention',
      label: 'Evidence retention',
      value: `${intFromEnv(env, 'ARTIFACT_RETENTION_DAYS', 30)} days`,
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
