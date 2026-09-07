import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule this file enforces: a spike script that imports TypeScript says to
 * run it with `tsx`, because `node` cannot.
 *
 * `CLAUDE.md` permits `experiments/` to depend on `src/`, and that permission
 * is used — `extract-docx-truth.mjs` reads `readLanguage` from
 * `src/integrations/documents/flat-odf.ts` rather than keeping a second parser
 * of the same fact. The cost is that the file can no longer be run the way it
 * says it can.
 *
 * `[V]` It said `Usage: node extract-docx-truth.mjs …` from the commit that
 * added the import until #217. On Node v20.20.2 that exits with
 *
 *     TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
 *
 * before doing any work — while the same command under `npx tsx` completes and
 * writes its truth files. Two research documents cite this script as the
 * instrument behind their .docx fidelity numbers, so it is neither dead nor
 * optional; its instructions were simply wrong, and nothing said so.
 *
 * Node's own type stripping (22.6 experimental, 23.6 default) would make this
 * moot on a newer runtime. Until the project moves, the runner named in the
 * file has to be one that works.
 *
 * ## What this cannot see
 *
 * Whether the command in a *document* is right. This checks the script's own
 * header, which is where the wrong one lived; no doc states an invocation
 * today, and if one starts to, it is outside what a file scan can reach.
 */

const ROOT = join('experiments', 'document-remediation');

/** Generated corpora and run output, not source. */
const ARTEFACT_DIRS =
  /^(out|corpus|holdout|real|word-corpus|vendor|node_modules|dist|classes)/;

/** `import … from '….ts'`, static or dynamic. */
const TS_IMPORT = /from\s+'[^']+\.ts'|import\(\s*'[^']+\.ts'\s*\)/;

const USAGE_LINE = /^.*\bUsage:\s*(.+)$/m;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (ARTEFACT_DIRS.test(entry)) continue;
      out.push(...sourceFiles(path));
    } else if (/\.m[jt]s$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('spike scripts that import TypeScript', () => {
  const files = sourceFiles(ROOT);
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
  const importTs = [...sources].filter(([, text]) => TS_IMPORT.test(text));

  it('scans a non-empty tree', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('still finds a script that imports TypeScript, so this is not vacuous', () => {
    // If this fails because the last such import was removed, delete this file
    // rather than weakening it — the rule has no subject left.
    expect(importTs.map(([file]) => file).join('\n')).not.toBe('');
  });

  it('names a runner that can actually load them', () => {
    const wrong = importTs
      .map(([file, text]) => {
        const usage = USAGE_LINE.exec(text)?.[1]?.trim();
        if (usage === undefined) return `${file}  (imports .ts and states no Usage line)`;
        if (!/\btsx\b/.test(usage)) return `${file}  Usage: ${usage}`;
        return '';
      })
      .filter(Boolean);

    expect(
      wrong.join('\n'),
      'This file imports a .ts module, so `node` cannot run it — it exits with ' +
        'ERR_UNKNOWN_FILE_EXTENSION before doing any work. Say `npx tsx <script>` ' +
        'in its Usage line, or drop the TypeScript import.',
    ).toBe('');
  });
});
