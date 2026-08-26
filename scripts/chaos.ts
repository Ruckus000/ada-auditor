import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHAOS_SCENARIOS,
  DEFAULT_CHAOS_FIXTURE_DIR,
  expectedCiStatusForScenario,
  isChaosEnabled,
  resolveChaosRunParams,
} from '../src/app/api/_lib/chaos';
import { discoverLinks } from '../src/integrations/browser/discover-links';
import { UnsafeTargetError } from '../src/integrations/browser/target-url';
import { runBrowserAudit } from '../src/integrations/browser/run-browser-audit';
import { logInfo } from '../src/services/logger';

function fail(message: string): never {
  console.error(`CHAOS FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!isChaosEnabled()) {
    fail('CHAOS_ENABLED must be set to "true" to run chaos assertions.');
  }

  console.log('CHAOS: starting steady-state assertions (auditor platform only)');

  for (const scenario of CHAOS_SCENARIOS) {
    const params = resolveChaosRunParams(scenario);
    const artifactsDir = await mkdtemp(join(tmpdir(), `ada-chaos-${scenario}-`));
    const expected = expectedCiStatusForScenario(scenario);

    try {
      // Calls the runner directly rather than going through `startRun`, so the
      // run budget does not apply. Deliberate: chaos asserts steady-state
      // behaviour and must not start failing because an earlier suite used up
      // an hourly ceiling. A budget that makes chaos flaky is worse than no
      // budget, because it teaches people to re-run red.
      const report = await runBrowserAudit({
        journeyId: params.journeyId,
        environment: params.environment,
        stepId: params.stepId,
        fixtureDir: params.fixtureDir,
        artifactsDir,
        omitAxTree: params.omitAxTree,
        steps: params.steps,
        maxPages: params.maxPages,
        budgetMs: params.budgetMs,
        platformHint: params.platformHint,
      });

      if (report.ciStatus !== expected) {
        fail(`scenario ${scenario}: expected ciStatus=${expected}, got ${report.ciStatus}`);
      }

      // A run must audit every page its journey walked through. Asserting only
      // on ciStatus would let a regression to single-page scanning pass three
      // of these four scenarios unnoticed.
      if (scenario === 'browser_passthrough_violations') {
        const onPassedThroughPage = report.findings.filter(
          (finding) =>
            finding.source === 'deterministic' && finding.pageUrl.endsWith('violations.html'),
        );

        if (onPassedThroughPage.length < 5) {
          fail(
            `scenario ${scenario}: expected >=5 findings on the page walked through, got ${onPassedThroughPage.length}`,
          );
        }
      }

      // A run the cap cut short has to say so. Silence here reads as "we
      // audited the site" to a client who has no other way to know how much of
      // it was seen, which is the one thing a partial audit must never do.
      if (scenario === 'browser_page_cap_truncates') {
        if (report.pages.length !== 2) {
          fail(`scenario ${scenario}: expected the cap to hold at 2 pages, got ${report.pages.length}`);
        }

        if (report.truncatedPages !== 1) {
          fail(
            `scenario ${scenario}: expected truncatedPages=1, got ${report.truncatedPages} — a cap that does not report what it skipped is a silent partial audit`,
          );
        }

        // And the pages it did audit still carry their findings, so truncation
        // cannot be a way for a violation to go unreported.
        const insideTheCap = report.findings.filter(
          (finding) =>
            finding.source === 'deterministic' && finding.pageUrl.endsWith('violations.html'),
        );

        if (insideTheCap.length === 0) {
          fail(`scenario ${scenario}: truncation dropped the findings on a page inside the cap`);
        }
      }

      // A count cap cannot bound a duration, and the walk's second bound is the
      // one that stops a slow real site before the platform does. The claim is
      // that a run the *clock* cut short says so, names the clock, and still
      // reports what it found.
      if (scenario === 'browser_time_budget_truncates') {
        if (report.pages.length !== 1) {
          fail(
            `scenario ${scenario}: expected the walk to audit exactly the page it landed on, got ${report.pages.length}`,
          );
        }

        // A spent budget must still buy one page. A zero-page run is the
        // evidence-free outcome this bound exists to remove, not to produce.
        if (report.truncatedPages !== 2) {
          fail(
            `scenario ${scenario}: expected truncatedPages=2, got ${report.truncatedPages} — a budget that does not report what it skipped is a silent partial audit`,
          );
        }

        if (report.truncationReason !== 'budget') {
          fail(
            `scenario ${scenario}: expected truncationReason=budget, got ${report.truncationReason} — an operator reading "page-cap" raises a number that was not the problem`,
          );
        }

        // And the page it did audit still carries its findings. Truncation is
        // not a verdict modifier: the expected ciStatus above is `fail`, and it
        // has to fail on real violations rather than on being incomplete.
        const onTheOnePage = report.findings.filter(
          (finding) =>
            finding.source === 'deterministic' && finding.pageUrl.endsWith('violations.html'),
        );

        if (onTheOnePage.length === 0) {
          fail(`scenario ${scenario}: the budget dropped the findings on the page it audited`);
        }
      }

      // The hint wins over the markup. The fixture says React; only the hint
      // being read produces WordPress.
      if (scenario === 'browser_hint_beats_markup') {
        if (report.platform.id !== 'wordpress') {
          fail(
            `scenario ${scenario}: expected the explicit hint to win, got platform=${report.platform.id}`,
          );
        }
      }

      /**
       * Timing has to be real, and internally consistent.
       *
       * Presence and consistency only — never a wall-clock threshold. A
       * threshold in CI is a flaky test that fails on a busy runner and
       * teaches people to re-run red, while a *missing* measurement is a real
       * regression: the page cap and the function limit are about to be
       * re-decided from these numbers, and silently reporting zero would be
       * worse than reporting nothing.
       */
      const untimed = report.pages.filter((page) => !(page.timing?.totalMs > 0));
      if (untimed.length > 0) {
        fail(`scenario ${scenario}: ${untimed.length} page(s) carry no duration`);
      }

      // `scanMs` is only absent when a run asked to skip its scan, and chaos
      // never does — `runBrowserAudit` doesn't even accept that flag. A
      // missing value here is a real regression, caught the same way an
      // untimed page is above, so the cast below is asserting a fact this
      // check just proved rather than papering over the optional type.
      const unscanned = report.pages.filter((page) => page.timing.scanMs === undefined);
      if (unscanned.length > 0) {
        fail(`scenario ${scenario}: ${unscanned.length} page(s) carry no scan duration`);
      }

      const slowerThanScan = report.pages.filter(
        (page) => (page.timing.scanMs as number) > page.timing.totalMs,
      );
      if (slowerThanScan.length > 0) {
        fail(`scenario ${scenario}: a page's axe scan is timed longer than the page itself`);
      }

      const pageTotal = report.pages.reduce((sum, page) => sum + page.timing.totalMs, 0);
      if (report.phaseMs.journey < pageTotal) {
        fail(
          `scenario ${scenario}: journey phase (${report.phaseMs.journey}ms) is shorter than the pages it contains (${pageTotal}ms)`,
        );
      }

      logInfo('chaos_result', {
        scenario,
        evidenceStatus: report.evidenceStatus,
        ciStatus: report.ciStatus,
        expectedCiStatus: expected,
        findings: report.findings.length,
        pagesScanned: report.pages.length,
        pass: true,
      });
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }

  // Discovery's frontier is filled by whatever markup a page happens to
  // contain, not authored by an operator the way a run's steps are — so "the
  // crawler will not fetch a private, loopback or cloud-metadata address" is a
  // claim about what this product does not do, not merely about one function
  // a unit test can cover in isolation. It belongs here for the same reason
  // the scenarios above do: a unit test proves the guard exists today, this
  // proves it still holds against the guard's actual call path, unmocked.
  console.log('CHAOS: asserting discovery refuses a private entry point');

  const unsafeDiscoveryTargets = [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:22/',
    'http://10.0.0.1/admin',
  ];

  for (const targetUrl of unsafeDiscoveryTargets) {
    let refusal: unknown;
    try {
      await discoverLinks({ targetUrl });
      fail(`discovery accepted an unsafe entry point: ${targetUrl}`);
    } catch (error) {
      refusal = error;
    }

    // The *type*, not merely that something was thrown — and this is the whole
    // assertion. Delete the guard and these three addresses still reject on any
    // machine this ever runs on: link-local and RFC1918 do not answer, and
    // loopback:22 refuses the connection. All three arrive as
    // `EntryPointUnreachableError`, so a bare `catch {}` passes with the SSRF
    // check gone — against a crawler that has by then really dialled the cloud
    // metadata endpoint. `discover-links.test.ts` states the same rule for the
    // same reason: an error that a dead host would also produce proves nothing.
    //
    // `UnsafeTargetError` is also what proves the refusal happened *before* the
    // browser launched — `discoverLinks` resolves and range-checks the entry
    // point first, so a run that reaches Playwright cannot answer with this
    // type.
    if (!(refusal instanceof UnsafeTargetError)) {
      const name = refusal instanceof Error ? refusal.name : typeof refusal;
      fail(`discovery refused ${targetUrl} as ${name}, not as an unsafe target`);
    }
  }

  logInfo('chaos_result', {
    scenario: 'discovery_refuses_private_entry_point',
    targets: unsafeDiscoveryTargets.length,
    pass: true,
  });

  /**
   * An empty scope denies everything rather than allowing it.
   *
   * Free-standing rather than a `CHAOS_SCENARIOS` entry, for the same reason
   * the discovery check above is: the table compares a report's `ciStatus`,
   * and a refusal produces no report at all. That is the point — the guard
   * runs before the browser launches, so an out-of-scope journey is never
   * walked and never has pages to store.
   *
   * The steady-state rule names the fail-*closed* direction specifically, and
   * that is the half a permissive default would break silently: `[]` is not
   * nullish, so it must not fall through to "allow this journey". A unit test
   * proves the comparison; this proves the comparison is still what
   * `runBrowserAudit` asks before it does anything.
   */
  console.log('CHAOS: asserting an empty run scope denies rather than allows');

  const deniedArtifactsDir = await mkdtemp(join(tmpdir(), 'ada-chaos-scope-'));
  let scopeRefusal: unknown;

  try {
    await runBrowserAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      stepId: 'denied',
      fixtureDir: DEFAULT_CHAOS_FIXTURE_DIR,
      artifactsDir: deniedArtifactsDir,
      allowedJourneyIds: [],
      steps: [{ action: 'navigate', type: 'goto', path: 'login.html' }],
    });
    fail('an empty run scope allowed a journey instead of denying it');
  } catch (error) {
    scopeRefusal = error;
  } finally {
    await rm(deniedArtifactsDir, { recursive: true, force: true });
  }

  // The message, because that is all this refusal carries — it predates the
  // typed guards and throws a plain Error. Asserting only "something threw"
  // would pass if the fixture path broke instead, which is exactly the way
  // this scenario could quietly stop testing anything.
  const scopeMessage = scopeRefusal instanceof Error ? scopeRefusal.message : String(scopeRefusal);
  if (!scopeMessage.includes('not allowed by run contract scope')) {
    fail(`an empty run scope refused with the wrong reason: ${scopeMessage}`);
  }

  logInfo('chaos_result', {
    scenario: 'empty_scope_denies_the_journey',
    pass: true,
  });

  console.log('CHAOS: all steady-state assertions passed');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'unknown chaos error');
});
