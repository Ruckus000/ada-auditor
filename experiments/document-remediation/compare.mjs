// Computes the DELIVERABLE / NEEDS_REVIEW / INCONCLUSIVE verdict from evidence
// rather than from opinion.
//
// Experiment 1 decided this from a hand-written map I populated by inspecting
// output. That cannot support experiment 2's gate: "zero semantic false
// positives", measured by the party trying to pass the gate, is an opinion with
// a table around it. Here the verdict is derived from two independent sources —
// veraPDF for machine conformance, Inspect.java for structure — checked against
// the ground truth authored before any tool touched the file.
//
// Usage: node compare.mjs <pdfDir> <phase5SummaryJson>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const CP = `vendor/pdfbox-app-3.0.8.jar:out/classes`;

const [pdfDir, summaryPath] = process.argv.slice(2);
if (!pdfDir || !summaryPath) {
  console.error('usage: node compare.mjs <pdfDir> <phase5SummaryJson>');
  process.exit(2);
}

const validation = Object.fromEntries(
  JSON.parse(readFileSync(summaryPath)).map((r) => [r.document, r]),
);

const PLACEHOLDER = /^\s*(image|figure|picture|graphic)\s*\d*\s*$/i;
const STOP = new Set(['the','a','an','of','at','in','on','and','or','is','are','to','from','which','that','with','its','it','as','by','for','was','were','be','this','their']);

const significant = (s) =>
  new Set((s ?? '').toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);

function inspect(file) {
  return JSON.parse(execFileSync(`${JAVA_HOME}/bin/java`, ['-cp', CP, 'Inspect', file], {
    maxBuffer: 32 * 1024 * 1024,
  }).toString());
}

// Two kinds of defect, and only one of them is a safety failure.
//
// ASSERTION — the pipeline stated something that contradicts ground truth: alt
// text on a decorative graphic, TH on a cell that is not a header, a heading
// level that disagrees, a caption bound to the wrong figure, OCR text that is
// not what the page says. These are actively harmful. A screen-reader user is
// misled rather than merely underserved, and a reviewer has no signal that
// anything is wrong. This is the hard gate: it must be zero.
//
// OMISSION — the pipeline did not state something: no alt, no TH, no heading.
// Bad, and the reason a document is NEEDS_REVIEW rather than DELIVERABLE, but
// honest. A human sees the gap.
//
// Lumping them, as the first version of this file did, makes "zero false
// positives" a statement about arithmetic rather than about safety.
const ASSERTION = 'assertion';
const OMISSION = 'omission';

function defectsFor(gt, s) {
  const d = [];
  const assert_ = (msg) => d.push({ kind: ASSERTION, msg });
  const omit = (msg) => d.push({ kind: OMISSION, msg });

  // --- figures -------------------------------------------------------------
  const gtFigures = (gt.figures ?? []).filter((f) => typeof f === 'object');
  const meaningful = gtFigures.length;
  const captioned = gtFigures.filter((f) => f.captionPresent === true);

  for (const f of s.figures) {
    if (f.alt == null || f.alt.trim() === '') {
      if (!f.actualText) omit('figure with no Alt and no ActualText');
    } else if (PLACEHOLDER.test(f.alt)) {
      // An assertion, not an omission. "image 1" is not a gap a reviewer can
      // see — the Alt slot is filled, veraPDF is satisfied, and the document
      // looks remediated. That is what makes it dangerous.
      assert_(`placeholder alt text "${f.alt}" presented as a description`);
    }
  }

  // A caption exists in the document and the alt does not reflect it.
  for (const c of captioned) {
    const want = significant(c.caption);
    const matched = s.figures.some((f) => {
      const got = significant(f.alt);
      let hits = 0;
      for (const w of want) if (got.has(w)) hits++;
      return hits >= 3;
    });
    if (!matched) omit(`caption present but no figure alt reflects it: "${(c.caption ?? '').slice(0, 60)}..."`);
  }

  // How many Figure elements SHOULD exist: one per meaningful figure, plus one
  // per distinct repeated image. A logo on five pages is one description or an
  // artifact — five Figure elements describing it is the defect, and counting
  // its occurrences as meaningful would hide that.
  const distinctRepeats = (gt.repeatedImages ?? []).length;
  const expectedFigures = meaningful + distinctRepeats;
  if (s.figures.length > expectedFigures) {
    const extra = s.figures.length - expectedFigures;
    assert_(`${s.figures.length} Figure elements for ${expectedFigures} expected (${meaningful} meaningful + ${distinctRepeats} distinct repeated) — ${extra} extra: decorative or repeated graphics described as content rather than marked as artifacts`);
  }

  // --- tables --------------------------------------------------------------
  const gtTables = (gt.tables ?? []).filter((t) => t.purpose !== 'layout only');
  if (gtTables.length > s.tables.length) {
    omit(`${gtTables.length} table(s) in ground truth, ${s.tables.length} detected`);
  }
  for (const [i, t] of s.tables.entries()) {
    if (gtTables[i] && t.th === 0) {
      omit(`table ${i + 1} has ${t.td} data cells and zero /TH — header relationships absent`);
    }
  }
  // A layout table must NOT become a data table.
  if ((gt.tables ?? []).some((t) => t.purpose === 'layout only') && s.tables.length > gtTables.length) {
    assert_('layout table tagged as a data table — header relationships invented');
  }

  // --- headings ------------------------------------------------------------
  // Over- and under-detection are different failures. Extra headings are
  // invented structure a reader will navigate by; missing ones are structure a
  // reader does not get. Only the first misleads.
  const want = (gt.headingHierarchy ?? []).map((h) => `H${h.level}`);
  if (want.length && JSON.stringify(want) !== JSON.stringify(s.headings)) {
    const detail = `got ${JSON.stringify(s.headings)}, ground truth ${JSON.stringify(want)}`;
    if (s.headings.length > want.length) assert_(`heading over-detection — ${detail}`);
    else if (s.headings.length < want.length) omit(`heading under-detection — ${detail}`);
    else assert_(`heading levels disagree at equal count — ${detail}`);
  }

  // --- text ----------------------------------------------------------------
  const expectsText = !(gt.intentionalProblems ?? []).some((p) => /no text layer/i.test(p));
  if (expectsText && s.textChars < 50) omit(`expected text but extracted ${s.textChars} chars`);
  if (!expectsText && s.textChars < 50) omit('no text layer — OCR did not run');

  // --- document level ------------------------------------------------------
  if (!s.lang) omit('no document /Lang');
  if (!s.title) omit('no document title');

  return d;
}

const rows = [];
for (const f of readdirSync(pdfDir).filter((x) => x.endsWith('.pdf')).sort()) {
  const name = basename(f, '.pdf');
  const gt = JSON.parse(readFileSync(join('corpus', `${name}.ground-truth.json`)));
  const s = inspect(join(pdfDir, f));
  const defects = defectsFor(gt, s);
  const compliant = validation[name]?.ua1?.compliant ?? false;

  const assertions = defects.filter((x) => x.kind === ASSERTION);
  const verdict = !compliant ? 'INCONCLUSIVE' : defects.length ? 'NEEDS_REVIEW' : 'DELIVERABLE';
  rows.push({ document: name, verdict, ua1: compliant, assertions: assertions.length, defects, structure: s });

  console.log(`${name.padEnd(26)} ${verdict.padEnd(13)} ua1=${compliant ? 'pass' : 'FAIL'} assert=${assertions.length} omit=${defects.length - assertions.length}`);
  for (const x of defects) console.log(`    ${x.kind === ASSERTION ? '!' : '-'} ${x.msg}`);
}

writeFileSync('out/comparison.json', JSON.stringify(rows, null, 2));

const n = rows.length;
const c = (v) => rows.filter((r) => r.verdict === v).length;
// A semantic false positive is DELIVERABLE while carrying a known defect. The
// verdict is derived so this cannot happen by construction — asserted anyway,
// because the gate depends on it and a silent regression here would be invisible.
const totalAssertions = rows.reduce((a, r) => a + r.assertions, 0);
const docsWithAssertions = rows.filter((r) => r.assertions > 0).length;
console.log(`\nDELIVERABLE ${c('DELIVERABLE')}/${n}  NEEDS_REVIEW ${c('NEEDS_REVIEW')}/${n}  INCONCLUSIVE ${c('INCONCLUSIVE')}/${n}`);
console.log(`false assertions: ${totalAssertions} across ${docsWithAssertions}/${n} documents  <-- the safety gate`);
console.log(`omissions:        ${rows.reduce((a, r) => a + r.defects.length - r.assertions, 0)}`);

// Two separate gates. A DELIVERABLE carrying any defect is a bug in this file,
// since the verdict is derived from the defect list. A false assertion anywhere
// — on a NEEDS_REVIEW document too — is the safety failure that matters, because
// the wrong claim is in the delivered bytes regardless of what we labelled it.
const misgraded = rows.filter((r) => r.verdict === 'DELIVERABLE' && r.defects.length);
if (misgraded.length) { console.error(`\nBUG: ${misgraded.length} DELIVERABLE with defects`); process.exit(2); }
if (totalAssertions > 0) process.exit(1);
