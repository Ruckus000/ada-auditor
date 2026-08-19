import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHAOS_SCENARIOS,
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

  console.log('CHAOS: all steady-state assertions passed');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'unknown chaos error');
});
