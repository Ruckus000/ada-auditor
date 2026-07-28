import {
  CHAOS_SCENARIOS,
  expectedCiStatusForScenario,
  isChaosEnabled,
  resolveChaosRunParams,
} from '../src/app/api/_lib/chaos';
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

  console.log('CHAOS: all steady-state assertions passed');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'unknown chaos error');
});
