// The 31 real municipal Word documents through the SHIPPING pipeline, scored
// by the fidelity instrument that now runs in production.
//
// Sibling of `measure-pdf-population.mts`: a measurement harness that imports
// production code and adds nothing of its own. Every number it prints comes
// from `convertSourceToPdf` and `checkFidelity` exactly as a real conversion
// would compute them — a second implementation here would be a second
// instrument, and this project has already paid for that mistake once.
//
// Usage:
//   npx tsx experiments/document-remediation/measure-source-fidelity.mts <dir> [outDir]
//
// The real bytes are gitignored and local-only; pass the path.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertSourceToPdf } from '../../src/integrations/documents/convert.ts';
import { checkFidelity } from '../../src/domain/source-fidelity.ts';
import { summarise, withFidelity } from '../../src/domain/document-remediation.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const [dir, outDir] = process.argv.slice(2);
if (!dir) {
  console.error('usage: measure-source-fidelity.mts <dir-of-docx> [outDir]');
  process.exit(2);
}

const files = readdirSync(dir)
  .filter((f) => /\.docx?$/i.test(f))
  .sort();
if (outDir) mkdirSync(outDir, { recursive: true });

const rows: Array<Record<string, unknown>> = [];
let assertions = 0;
let docsWithAssertions = 0;
let docsWithOmissions = 0;
let engineDerived = 0;
let converted = 0;
let refused = 0;

for (const file of files) {
  const id = basename(file).replace(/\.docx?$/i, '');
  const work = mkdtempSync(join(tmpdir(), 'fidelity-'));
  const output = join(work, `${id}.pdf`);
  const started = Date.now();

  try {
    const result = await convertSourceToPdf(join(dir, file), output, {
      root: REPO_ROOT,
      sourceName: file,
    });

    if (!result.ok) {
      refused++;
      const row = { id, file, ok: false, failure: result.failure };
      rows.push(row);
      console.log(`${id.padEnd(5)} REFUSED  ${result.failure.kind}`);
      continue;
    }

    converted++;
    const { sourceTruth, structure } = result.provenance;
    const fidelity = checkFidelity(sourceTruth, structure);
    const summary = withFidelity(summarise(result.provenance), fidelity);

    const defects = fidelity.checked ? fidelity.defects : [];
    const a = defects.filter((d) => d.kind === 'assertion');
    const o = defects.filter((d) => d.kind === 'omission');
    assertions += a.length;
    if (a.length > 0) docsWithAssertions++;
    if (o.length > 0) docsWithOmissions++;
    if (fidelity.checked && fidelity.oracle === 'engine-derived') engineDerived++;

    const row = {
      id,
      file,
      ok: true,
      ms: Date.now() - started,
      oracle: fidelity.checked ? fidelity.oracle : 'not-checked',
      source: sourceTruth.readable
        ? {
            headings: sourceTruth.headings,
            headingLevels: sourceTruth.headingLevels,
            tables: sourceTruth.tables,
            listItems: sourceTruth.listItems,
            figures: sourceTruth.figures,
            figuresWithAlt: sourceTruth.figuresWithAlt,
            language: sourceTruth.language,
            hasTitle: sourceTruth.title !== null,
          }
        : null,
      delivered: {
        headings: structure.headings.length,
        headingLevels: structure.headings,
        tables: structure.tables.length,
        listItems: structure.lists.reduce((t, l) => t + l.items, 0),
        figures: structure.figures.length,
        figuresWithAlt: structure.figures.filter((f) => f.alt !== null).length,
        language: structure.lang,
        hasTitle: structure.title !== null,
      },
      assertions: a,
      omissions: o,
      gaps: summary.gaps,
      needs: summary.needs?.length ?? 0,
    };
    rows.push(row);
    if (outDir) writeFileSync(join(outDir, `${id}.json`), JSON.stringify(row, null, 2) + '\n');

    const verdict = a.length > 0 ? 'ASSERTION' : o.length > 0 ? 'omission ' : 'faithful ';
    console.log(
      `${id.padEnd(5)} ${verdict} ${String(fidelity.checked ? fidelity.oracle : '-').padEnd(15)}` +
        ` h ${row.source?.headings ?? '?'}->${row.delivered.headings}` +
        ` t ${row.source?.tables ?? '?'}->${row.delivered.tables}` +
        ` li ${row.source?.listItems ?? '?'}->${row.delivered.listItems}` +
        ` f ${row.source?.figures ?? '?'}->${row.delivered.figures}` +
        ` alt ${row.source?.figuresWithAlt ?? '?'}->${row.delivered.figuresWithAlt}` +
        (defects.length ? `  | ${defects.map((d) => `${d.kind[0]}:${d.criterion}`).join(' ')}` : ''),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const summaryRow = {
  documents: files.length,
  converted,
  refused,
  assertions,
  docsWithAssertions,
  docsWithOmissions,
  engineDerived,
};
console.log('\n' + JSON.stringify(summaryRow, null, 2));
if (outDir) {
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ summaryRow, rows }, null, 2) + '\n');
  console.log(`\nwrote ${rows.length} rows to ${outDir}`);
}

// The same gate the pipeline applies, so a non-zero exit here means the corpus
// would have had a delivery refused.
process.exit(assertions > 0 ? 1 : 0);
