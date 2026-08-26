import { writeFile } from 'node:fs/promises';
import { MAX_RUN_DURATION_MS, resolveWalkBudgetMs } from '../src/domain/run-limits';
import { logInfo } from '../src/services/logger';
import { loadEnvLocal } from './load-env';

/**
 * One real audit, against a real site, through a running `next start`.
 *
 * This is the only check that exercises the *built application*. Vitest loads
 * modules unbundled, so a packaging fault is invisible to every suite — which
 * is exactly how `@axe-core/playwright` once shipped with its injected source
 * mangled and every run through the app failing while CI stayed green. The
 * chaos suite calls the runner directly and so cannot see it either.
 *
 * It also produces the numbers the page cap is supposed to be set from.
 * `AGENTS.md` has called that cap "a guess, not a measurement" since it was
 * written, because nothing ever measured it.
 *
 *   npm run build && npm start &          # or `next start`
 *   npm run smoke:real -- --url https://example.com --steps 6 --json out.json
 *
 * Deliberately NOT wired into CI. It depends on somebody else's site staying
 * up, and a suite that fails for a third party's outage trains people to
 * ignore red.
 */

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fail(message: string): never {
  console.error(`SMOKE FAIL: ${message}`);
  process.exit(1);
}

type RunPage = { route?: string; durationMs?: number; evidenceStatus?: string };

async function main(): Promise<void> {
  loadEnvLocal();

  const base = (flag('base', 'http://localhost:3000') ?? '').replace(/\/$/, '');
  const target = flag('url');
  const token = process.env.AUDITOR_RUN_TOKEN;

  if (!target) fail('--url is required. Point it at a public, multi-page site.');
  if (!token) fail('AUDITOR_RUN_TOKEN is not set.');

  // A journey that actually walks: land, then follow in-scope links. The point
  // is several pages, because a one-page run measures nothing about the cap.
  const stepCount = Number(flag('steps', '5'));

  // Land on the page `--url` names, not on the site root.
  //
  // Navigation paths resolve against the target as a base, and a leading
  // slash is origin-absolute, so a literal '/' discarded the path every time:
  // `--url https://www.w3.org/WAI/` audited `https://www.w3.org/`. The run
  // still looked healthy — six pages, evidence complete — while measuring a
  // page nobody had asked for.
  const entry = new URL(target);
  const entryPath = `${entry.pathname}${entry.search}`;

  const steps = [
    { action: 'navigate', type: 'goto', path: entryPath },
    // Each step takes a link further down the page than the last.
    //
    // Clicking the first link every time walked in a circle: the first link
    // on `https://www.w3.org/` is a language switcher to `/ja`, whose own
    // first link points back. Six captures, two pages, three visits each —
    // and the run reported `pagesAudited: 6` with the findings on those two
    // pages counted three times over.
    //
    // Advancing the index is a heuristic, not a crawler; it just has to stop
    // the walk retracing one edge. A page with fewer visible links than the
    // step index fails the click, which is loud and is the right way for a
    // synthetic journey to run out of road.
    //
    // `:visible` because a link that exists is not a link that can be clicked.
    // A six-step walk died at step 5 on `https://www.w3.org/`, whose fourth
    // link is an ordinary `<a href>` sitting in a collapsed menu: `visibility:
    // visible`, and a 0×0 box. Playwright's actionability wait can never
    // resolve against that, so the step burned the whole step timeout and
    // failed — and a longer timeout would not have helped, because the element
    // is not clickable at any point. `:visible` is defined as exactly that
    // pair of conditions, and it applies before `nth=`, so the index counts
    // only links a click could land on.
    //
    // Same host, because the run is already confined to one. With `:visible`
    // fixed, the walk got a step further and clicked "Sign in" on
    // `https://www.w3.org/`, and `assertSettledOnTarget` refused
    // `auth.w3.org` — correctly, and for the reason its own comment gives:
    // ending on an identity provider means the run walked somebody else's
    // login page, which scores well because a login page is small and tidy.
    // A blind index has no idea which links leave the site, so it is told.
    //
    // Root-relative or absolute-on-the-target's-origin, and never
    // protocol-relative — `//evil.example` is off-site with an on-site look.
    // This subsumes the `#` and `mailto:` exclusions that used to be spelled
    // out here, since neither starts with `/`. It also drops document-relative
    // links, which only shrinks the pool and is safe: the walk picks a
    // different link, it does not leave the host.
    ...Array.from({ length: Math.max(0, stepCount - 1) }, (_step, index) => ({
      action: 'navigate',
      type: 'click',
      selector: `a:is([href^="/"], [href^="${entry.origin}/"]):not([href^="//"]):visible >> nth=${index}`,
    })),
  ];

  const startedAt = Date.now();
  const response = await fetch(`${base}/api/audit/run?wait=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      journeyId: `smoke-${new URL(target).hostname}`,
      environment: 'production',
      targetUrl: target,
      steps,
    }),
  });

  const body = (await response.json()) as {
    error?: string;
    requestId?: string;
    ciStatus?: string;
    evidenceStatus?: string;
    score?: number | null;
    findings?: unknown[];
    pages?: RunPage[];
    durationMs?: number;
    truncatedPages?: number;
    truncationReason?: string;
  };

  if (!response.ok) {
    fail(`${response.status} ${body.error ?? 'unknown error'} (requestId ${body.requestId})`);
  }

  const pages = body.pages ?? [];
  const durations = pages
    .map((page) => page.durationMs)
    .filter((ms): ms is number => typeof ms === 'number');

  const slowestPageMs = durations.length > 0 ? Math.max(...durations) : null;

  /**
   * The measurement, said plainly, and against the constants the product
   * actually uses.
   *
   * These were hardcoded `300_000` and `240_000`, so the one script whose
   * purpose is to produce the numbers the bounds get re-decided from measured
   * against a copy of them. `suggestedPageCap` in particular becomes literally
   * what it claims to be: how many of *this site's* pages fit inside the walk
   * budget — not inside a round number somebody typed once.
   */
  const result = {
    target,
    requestId: body.requestId,
    ciStatus: body.ciStatus,
    evidenceStatus: body.evidenceStatus,
    score: body.score ?? null,
    findings: body.findings?.length ?? 0,
    pagesAudited: pages.length,
    truncatedPages: body.truncatedPages ?? 0,
    // Which bound stopped the walk, when one did. On a real site this is the
    // reading that decides the next move: `page-cap` means raise the cap,
    // `budget` means the pages are slower than the function is long.
    truncationReason: body.truncationReason ?? null,
    walkBudgetMs: resolveWalkBudgetMs(),
    wallClockMs: Date.now() - startedAt,
    runDurationMs: body.durationMs,
    slowestPageMs,
    medianPageMs:
      durations.length > 0 ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null,
    headroomMs: MAX_RUN_DURATION_MS - (body.durationMs ?? 0),
    // How many of this site's pages fit in the walk budget. A recommendation to
    // check, not a value to apply blindly.
    suggestedPageCap:
      slowestPageMs !== null ? Math.max(1, Math.floor(resolveWalkBudgetMs() / slowestPageMs)) : null,
  };

  logInfo('smoke_real_result', result);

  // Byte-identical to the object logged above, so the artifact a workflow
  // uploads and the line a human reads cannot disagree about what was measured.
  const jsonPath = flag('json');
  if (jsonPath) {
    await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  for (const page of pages) {
    console.log(`  ${page.route ?? '?'}\t${page.durationMs ?? '?'}ms\t${page.evidenceStatus ?? '?'}`);
  }

  // Evidence is the product. A run that cannot prove what it saw is a failure
  // here even when the verdict looks fine.
  if (body.evidenceStatus !== 'complete') {
    fail(`evidence was ${body.evidenceStatus}, so this run proves nothing`);
  }
  if (pages.length < 2) {
    fail(`only ${pages.length} page audited — a single-page run measures nothing about the cap`);
  }
}

main().catch((error) => {
  console.error(`SMOKE FAIL: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
