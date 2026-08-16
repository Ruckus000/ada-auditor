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
     * It is not part of evidence completeness either. Degrading the page would
     * have discarded its findings — including the missing title itself.
     */
    title: z.string(),
    /**
     * The main-frame HTTP status the page was served with.
     *
     * Optional, and absent means *not measured* — never 200. A `file://`
     * fixture run has no HTTP status at all, and every page recorded before
     * this existed has none either. Defaulting it to 200 would manufacture a
     * measurement nobody took, on the exact field that decides whether the
     * page counted.
     */
    statusCode: z.number().int().optional(),
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
/**
 * Whether this page can be judged at all.
 *
 * This asked one question — were the three artifacts written — and now asks
 * two, the second being whether the page was served as an error. The widening
 * is deliberate rather than a new field: `complete` is the single gate that
 * derives findings (`run-browser-audit`), permits a score (`services/score`)
 * and permits a verdict (`services/reporting`). A page that cannot be judged
 * has to fail all three, and a second status with its own propagation would be
 * a second answer to the same question — which is how this codebase came to
 * decide "can this journey run" in four places that disagreed.
 *
 * So `degraded` means "do not draw conclusions from this page", and the reason
 * is carried separately: `statusCode` is the fact, this is the judgement.
 *
 * The code is persisted and reaches the API response; **no screen reads it
 * yet**, so today a degraded page cannot tell an operator whether it lost a
 * screenshot or came back 500. That is a known gap with a name — it is the
 * next slice of this phase — and it is written down rather than implied,
 * because the phase before this one shipped a `failureReason` that was stored,
 * classified and read by nothing for five merges.
 */
export type EvidenceStatus = 'complete' | 'degraded';

export type EvidenceBundle = EvidenceBundleInput & {
  status: EvidenceStatus;
};

/**
 * Generous for any real title. `deterministic-audit` caps axe's `outerHTML` at
 * 512 for the same reason; a title is a label rather than markup.
 */
const MAX_TITLE_LENGTH = 300;

/**
 * A page's title is whatever the audited site says it is.
 *
 * `document.title` has no length limit, and this one string is stored per page
 * per run, returned in the API response, rendered on the client screen and on
 * the public share page outside the auth gate, interpolated into the model
 * prompt in `services/ai-advisory`, and drawn into a Chromium PDF. A hostile —
 * or merely broken — page returning megabytes reaches every one of them.
 *
 * A function beside the schema rather than a `.max()` inside it, and that
 * distinction is the whole lesson of the field above: `createEvidenceBundle`
 * parses rather than safe-parses, so a `.max()` would *throw* on a long title
 * and destroy the run, exactly as `.min(1)` did on an empty one. Truncate the
 * page, never kill the run.
 *
 * Applied at capture, by the runner, so what is recorded is what was bounded —
 * a cap the storage layer applied after the fact would leave every other
 * consumer reading the unbounded string.
 *
 * The ellipsis is load-bearing: silently cutting a title presents a fragment as
 * the whole thing.
 *
 * Cutting by code unit can land inside a surrogate pair, and half a pair is not
 * valid UTF-8: it survives `JSON.stringify` as a lone `\uD83D` escape, which a
 * strict parser can reject, and it renders as `�` in a client's report. So the
 * cut drops a trailing high surrogate rather than keeping half a character.
 */
export function boundTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH).replace(/[\uD800-\uDBFF]$/, '')}…`;
}

/**
 * The page was served as an error, so nothing on it is evidence of anything.
 *
 * `page.goto`'s response was discarded and no status was read anywhere, so a
 * 500, a 404, an expired-session 403 or a bot challenge was navigated to,
 * scanned, screenshotted and stored exactly like the page it stood in for.
 * Error pages are small and clean, so a run that hit one scored *higher* than
 * a real audit and reported `pass` — the failure this whole phase exists for,
 * at the page level.
 *
 * 400 rather than 500 because a client-error page is the more dangerous half:
 * a 401 or 403 is what a silently-failed login actually returns, and that is
 * the case the product is most likely to meet and least able to survive
 * getting wrong.
 *
 * 3xx is not here. A redirect that was followed ends at the status of wherever
 * it landed, and one that was not followed is what the page is.
 *
 * What this does not cover, and cannot: the audited site chooses the status it
 * reports. A soft 404 — an error page served as 200 — passes straight through
 * and is scanned as though it were the real thing, which is the failure this
 * check *looks* like it closes and does not. Equally, a site can force every
 * run to `inconclusive` by serving 4xx. This is a guard against honest
 * misconfiguration and broken deploys, not a control against a target that
 * wants to be misread; the declared expectation in Phase 3 is what starts to
 * cover the soft-404 half, because it asserts what should be on the page
 * rather than trusting what the server said about it.
 */
function servedAsError(statusCode?: number): boolean {
  return statusCode !== undefined && statusCode >= 400;
}

export function createEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle {
  const parsed = evidenceInputSchema.parse(input);
  const complete =
    Boolean(
      parsed.artifacts.screenshotPath &&
        parsed.artifacts.domSnapshotPath &&
        parsed.artifacts.axTreePath,
    ) && !servedAsError(parsed.page.statusCode);

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
