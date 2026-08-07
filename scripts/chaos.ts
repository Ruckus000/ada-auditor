import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHAOS_SCENARIOS,
  expectedCiStatusForScenario,
  isChaosEnabled,
  resolveChaosRunParams,
} from '../src/app/api/_lib/chaos';
import { runBrowserAudit } from '../src/integrations/browser/run-browser-audit';

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

      console.log(
        JSON.stringify({
          type: 'chaos_result',
          scenario,
          evidenceStatus: report.evidenceStatus,
          ciStatus: report.ciStatus,
          expectedCiStatus: expected,
          findings: report.findings.length,
          pagesScanned: report.pages.length,
          pass: true,
        }),
      );
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }

  console.log('CHAOS: all steady-state assertions passed');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'unknown chaos error');
});
