import type {
  RunIntent,
  RunStatus,
  StoredFinding,
  StoredRunPage,
  StoredRunRecord,
} from '../domain/persistence';
import type { AuditFinding } from './reporting';
import type { CiStatus } from './reporting';

type PersistRunInput = {
  /** What the run was asked to walk. See `RunIntent`. */
  intent?: RunIntent;
  requestId: string;
  journeyId: string;
  environment: StoredRunRecord['environment'];
  platform: string;
  evidenceStatus: string;
  ciStatus: CiStatus;
  findings: AuditFinding[];
  durationMs: number;
  startedAt?: string;
  phaseMs?: Record<string, number>;
  browserMode?: boolean;
  pages?: StoredRunPage[];
  truncatedPages?: number;
  score?: number | null;
  scoreVersion?: number;
  status?: RunStatus;
  failureReason?: string;
};

/**
 * Findings persist with everything needed to act on them later: what failed,
 * where, which success criterion, and how to fix it. A stored run is the
 * record a client report and a regression diff are both built from, so
 * dropping fields here silently degrades both.
 */
function toStoredFinding(finding: AuditFinding): StoredFinding {
  if (finding.source === 'ai-advisory') {
    return {
      code: finding.code,
      severity: finding.severity,
      source: finding.source,
      message: finding.message,
      gateable: finding.gateable,
      confidence: finding.confidence,
    };
  }

  return {
    code: finding.code,
    severity: finding.severity,
    source: finding.source,
    title: finding.title,
    message: finding.message,
    // Stored even when empty, so a run recorded after the columns existed is
    // distinguishable from one recorded before them: `[]` means axe had
    // nothing to add, `undefined` means we never asked.
    remediationAnyOf: finding.remediation.anyOf,
    remediationAllOf: finding.remediation.allOf,
    wcagCriteria: finding.wcagCriteria,
    conformanceLevel: finding.conformanceLevel,
    // Without this a multi-page run stores findings that cannot say which page
    // they belong to, and the regression diff collapses the same rule and
    // selector on two pages into one entry.
    pageUrl: finding.pageUrl,
    selector: finding.selector,
    htmlSnippet: finding.htmlSnippet,
    helpUrl: finding.helpUrl,
  };
}

/**
 * A run's intent, with anything typed into the page taken out.
 *
 * `runs.intent` is durable and nothing prunes it — `prune-artifacts` clears
 * evidence blobs and never touches this column — so a value written here is
 * permanent, in the table and in every backup and branch cut from it. The
 * steady-state rule says no secret in a request body, a stored journey, or a
 * run log; this column would have been a fourth home the rule does not name.
 *
 * And it is reachable. `journeyStepSchema` still accepts `{type:'fill',
 * value}` — `containsInlineCredential` rejects a key *named* `password`, and
 * is not on the `/api/audit/run` path at all — so a literal posted there
 * passes every check in the system. `buildDefaultDemoJourneySteps` alone would
 * have put `value: 'demo-pass'` into production on the first console run.
 *
 * Stripped rather than hashed, because the shape has later work to do: what a
 * run was *supposed* to navigate is derivable from the step types, and a hash
 * of the array answers only "same or not". Stripped rather than kept and
 * redacted downstream, because a redaction the writer has to remember is one a
 * writer will forget — this is the single boundary every stored record passes
 * through.
 *
 * An allowlist, not a denylist. Removing a key called `value` is exhaustive
 * for today's `JourneyStep` and only for today's: a step type that later
 * carries a `token`, an `otp` or an `answer` would sail past a rule written
 * against one word, into a column nothing prunes. Keeping only the keys that
 * say *where* fails closed instead — a new field is dropped from the intent
 * until someone decides it belongs there, which is the direction to be wrong
 * in. The cost is that this list has to be updated when a step gains an
 * identifying field, and the comparison is what will notice: two runs that
 * differ only in the dropped field would compare as the same walk.
 *
 * Comparison is unaffected, and slightly improved: two runs of the same
 * journey either side of a password rotation walked the same path, and should
 * not read as incomparable because a secret changed.
 */
const STEP_KEYS_THAT_SAY_WHERE = ['action', 'type', 'path', 'selector', 'credentialRef', 'field'];

export function redactIntent(intent: RunIntent): RunIntent {
  return {
    steps: intent.steps.map((step) => {
      // Not an object: `steps` is `unknown[]` off a jsonb column, so nothing
      // guarantees one. Passed through — there is no key to keep or drop.
      if (!step || typeof step !== 'object' || Array.isArray(step)) return step;

      const source = step as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const key of STEP_KEYS_THAT_SAY_WHERE) {
        if (key in source) kept[key] = source[key];
      }
      return kept;
    }),
  };
}

export function toStoredRunRecord(input: PersistRunInput): StoredRunRecord {
  return {
    requestId: input.requestId,
    journeyId: input.journeyId,
    ...(input.intent ? { intent: redactIntent(input.intent) } : {}),
    environment: input.environment,
    platform: input.platform,
    evidenceStatus: input.evidenceStatus,
    ciStatus: input.ciStatus,
    findings: input.findings.map(toStoredFinding),
    durationMs: input.durationMs,
    createdAt: new Date().toISOString(),
    // Absent means not measured, and stays absent — the same rule the check
    // counts follow. A run recorded before timing existed did not take zero
    // milliseconds.
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(input.phaseMs ? { phaseMs: input.phaseMs } : {}),
    ...(input.browserMode ? { browserMode: true } : {}),
    ...(input.pages && input.pages.length > 0 ? { pages: input.pages } : {}),
    // Persisted, not just logged: the log line that recorded the truncation
    // does not survive the invocation, and a partial audit read back later
    // would otherwise be indistinguishable from a complete one.
    ...(input.truncatedPages ? { truncatedPages: input.truncatedPages } : {}),
    // A null score means "not measured" — omitted rather than stored as 0,
    // which is the worst possible score rather than the absence of one.
    ...(input.score !== null && input.score !== undefined
      ? { score: input.score, scoreVersion: input.scoreVersion ?? 1 }
      : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
  };
}
