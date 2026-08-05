import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BROWSER_CHAOS_SCENARIOS,
  CHAOS_SCENARIOS,
  expectedCiStatusForBrowserScenario,
  expectedCiStatusForScenario,
  isChaosEnabled,
  resolveBrowserChaosRunParams,
  resolveChaosRunParams,
} from '../src/app/api/_lib/chaos';
import { runBrowserAudit } from '../src/integrations/browser/run-browser-audit';
import { runAudit } from '../src/services/run-audit';

function fail(message: string): void {
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
    const report = await runAudit(params);
    const expected = expectedCiStatusForScenario(scenario);

    if (report.ciStatus !== expected) {
      fail(
        `scenario ${scenario}: expected ciStatus=${expected}, got ${report.ciStatus}`,
      );
    }

    console.log(
      JSON.stringify({
        type: 'chaos_result',
        scenario,
        evidenceStatus: report.evidenceStatus,
        ciStatus: report.ciStatus,
        expectedCiStatus: expected,
        pass: true,
      }),
    );
  }

  console.log('CHAOS: starting browser-mode steady-state assertions');

  for (const scenario of BROWSER_CHAOS_SCENARIOS) {
    const params = resolveBrowserChaosRunParams(scenario);
    const artifactsDir = await mkdtemp(join(tmpdir(), `ada-chaos-${scenario}-`));
    const expected = expectedCiStatusForBrowserScenario(scenario);

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
        fail(
          `scenario ${scenario}: expected ciStatus=${expected}, got ${report.ciStatus}`,
        );
      }

      console.log(
        JSON.stringify({
          type: 'chaos_result',
          scenario,
          evidenceStatus: report.evidenceStatus,
          ciStatus: report.ciStatus,
          expectedCiStatus: expected,
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
