/**
 * The blind test: walk three fixture sites that hide known barriers, and
 * report what the auditor saw against what is actually there.
 *
 *   npm run blind:test                      # all three sites
 *   npm run blind:test -- --site kestrel-cloud
 *   npm run blind:test -- --out ./somewhere
 *
 * Why fixtures over `file://` rather than a served origin: the SSRF guard
 * refuses loopback and private addresses, deliberately and correctly, so
 * `smoke:real` cannot be pointed at a local server. `runBrowserAudit` takes
 * `fixtureDir` for exactly this — it is a parameter of the runner and never of
 * the HTTP route, because a caller-supplied fixture directory would be a local
 * file read primitive. This script is a trusted caller in the same sense
 * `scripts/chaos.ts` is.
 *
 * What it does NOT cover, and `smoke:real` still does: the app's own bundle. A
 * packaging fault that breaks axe injection is invisible here, because Vitest
 * and tsx both load modules unbundled.
 *
 * Nothing is written to a run store. The blind test is a measurement of the
 * auditor, not an audit anyone should be able to cite, and a fixture run
 * landing in the portfolio would put an invented client's numbers on a real
 * screen.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { runBrowserAudit } from '../../src/integrations/browser/run-browser-audit';
import { advisoryModel } from '../../src/services/ai-advisory';
import type { DeterministicFinding } from '../../src/services/deterministic-audit';
import {
  cleanRate,
  coreHitRate,
  scoreSite,
  type Expectation,
  type ScoredFinding,
} from './score';

const SITES_ROOT = join(process.cwd(), 'fixtures/blind-test');
const DEFAULT_SITES = ['ridgeline-dental', 'fairview-township', 'kestrel-cloud'];

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

type SiteManifest = { site: string; label: string; profile: string; pages: string[] };

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function isDeterministic(finding: { source: string }): finding is DeterministicFinding {
  return finding.source === 'deterministic';
}

const OUTCOME_MARK: Record<string, string> = {
  hit: 'SEEN     ',
  miss: 'MISSED   ',
  downgraded: 'DOWNGRADE',
  upgraded: 'UPGRADED ',
  'caught-by-rules': 'BONUS    ',
  'clean-pass': 'quiet    ',
  'false-positive': 'FALSE POS',
};

async function auditOneSite(site: string, outDir: string) {
  const dir = join(SITES_ROOT, site);
  const manifest = await readJson<SiteManifest>(join(dir, 'site.json'));
  const key = await readJson<{ expectations: Expectation[] }>(join(dir, 'answer-key.json'));

  const artifactsDir = await mkdtemp(join(tmpdir(), `blind-${site}-`));

  try {
    const report = await runBrowserAudit({
      environment: 'staging',
      journeyId: `blind-test-${site}`,
      stepId: site,
      fixtureDir: dir,
      artifactsDir,
      steps: manifest.pages.map((page) => ({
        action: 'navigate' as const,
        type: 'goto' as const,
        path: page,
      })),
    });

    const deterministic: ScoredFinding[] = report.findings
      .filter(isDeterministic)
      .map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        selector: finding.selector,
        pageUrl: finding.pageUrl,
        wcagCriteria: finding.wcagCriteria,
        conformanceLevel: finding.conformanceLevel,
      }));

    const advisory = report.findings
      .filter((finding) => finding.source === 'ai-advisory')
      .map((finding) => finding.message);

    const score = scoreSite({
      site,
      expectations: key.expectations,
      findings: deterministic,
      advisory,
    });

    await writeFile(
      join(outDir, `${site}.json`),
      JSON.stringify({ manifest, report, score }, null, 2),
      'utf8',
    );

    return { manifest, report, deterministic, advisory, score };
  } finally {
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

async function main() {
  const only = flag('site');
  const sites = only ? [only] : DEFAULT_SITES;
  const outDir = flag('out', join(process.cwd(), '.blind-test')) as string;
  await mkdir(outDir, { recursive: true });

  const gatewayCredential = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);

  console.log('# Blind test\n');
  console.log(`advisory model : ${advisoryModel()}`);
  console.log(
    `gateway auth   : ${gatewayCredential ? 'present' : 'ABSENT — the advisory pass will degrade to no advisory'}`,
  );
  console.log(`results        : ${outDir}\n`);

  const summaries: string[] = [];

  for (const site of sites) {
    const { manifest, report, deterministic, advisory, score } = await auditOneSite(site, outDir);

    console.log(`\n## ${manifest.label} — ${manifest.pages.length} pages`);
    console.log(`${manifest.profile}\n`);
    console.log(
      `verdict ${report.ciStatus} · score ${report.score ?? 'null'} · evidence ${report.evidenceStatus} · ` +
        `${report.executiveSummary.totalFindings} findings, ${report.executiveSummary.blockingFindings} gating, ` +
        `${report.checksNeedingReview} undecided · advisory ${report.executiveSummary.advisoryFindings}`,
    );
    console.log(
      `journey ${report.phaseMs.journey}ms · advisory ${report.phaseMs.advisory}ms · ` +
        `checks ${report.checksPassed} passed / ${report.checksFailed} failed\n`,
    );

    for (const result of score.results) {
      const { expectation } = result;
      const rules = result.matchedRules.length ? ` [${[...new Set(result.matchedRules)].join(', ')}]` : '';
      // A rule fired on the element, but not the one that names the barrier.
      // Flagged, because an operator reading it is not told what is wrong.
      const wrongReason =
        result.predictedRuleFired === false && result.matchedRules.length > 0
          ? ` (not ${expectation.axeRule} — noticed for another reason)`
          : '';
      console.log(
        `  ${OUTCOME_MARK[result.outcome]} ${expectation.id} ${expectation.criterion} ${expectation.level} ` +
          `${expectation.page} ${expectation.selector} — ${expectation.what}${rules}${wrongReason}`,
      );
    }

    if (score.unexpected.length > 0) {
      console.log('\n  Reported but not planted:');
      for (const row of score.unexpected) {
        console.log(`    ${row.code} (${row.severity}) ×${row.count} on ${row.pages.join(', ')}`);
      }
    }

    if (advisory.length > 0) {
      console.log('\n  Advisory said:');
      for (const sentence of advisory) console.log(`    - ${sentence}`);
    }

    // Two numbers rather than one: barriers found is what the auditor is for,
    // and clean rows left alone is the guard on it. Merged, a site could raise
    // its rate by planting more correct markup.
    const core = coreHitRate(score);
    const clean = cleanRate(score);
    const line =
      `${manifest.label}: ${core.hits}/${core.total} core barriers seen · ` +
      `${score.counts.miss} missed · ${clean.quiet}/${clean.total} clean rows quiet · ` +
      `${score.counts['false-positive']} false positives · ` +
      `verdict ${report.ciStatus} · ${deterministic.length} deterministic findings`;
    summaries.push(line);
    console.log(`\n  ${line}`);
  }

  console.log('\n\n# Scorecard\n');
  for (const line of summaries) console.log(`- ${line}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
