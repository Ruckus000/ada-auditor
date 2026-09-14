#!/usr/bin/env node
/**
 * Planted Word cohort (c5) for heading-type training — ruling P1.
 *
 * Round 2 measured the training gap as heading DEPTH (25 H3, 1 H4). Every
 * document here has a perfect key because its structure is declared at the
 * source: outline levels by Heading1-4 style, by direct `w:outlineLvl`, or by
 * a custom style inheriting one through `w:basedOn`. Distractors carry no
 * outline level (or level 9, Word's Body Text override).
 *
 * The prose is written here, generic municipal and policy language; nothing is
 * taken from any corpus document. The builders are imported from the main
 * checkout by absolute path and never edited.
 *
 * Usage: node planted_cohort.mjs --out <dir> --count 100 --seed-base <int>
 * Output: <out>/real/c5-NNNN.docx and <out>/real-names.txt (P2 URL shape).
 * Same arguments give byte-identical files: a seeded PRNG, and the builders'
 * FIXED_MTIME plus `zip -X` for the package.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  emptyOutlinePara,
  fakeHeading,
  figure,
  heading,
  listItem,
  outlinePara,
  pageBreak,
  para,
  table,
  writeDocx,
} from '/Users/jphilistin/Documents/Coding/ADA Auditor/experiments/document-remediation/blind-corpus/docx-builders.mjs';

// ------------------------------------------------------------------ arguments

function parseArgs(argv) {
  const out = { out: null, count: 100, seedBase: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--out') out.out = argv[++i];
    else if (k === '--count') out.count = Number(argv[++i]);
    else if (k === '--seed-base') out.seedBase = Number(argv[++i]);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!out.out || !Number.isInteger(out.count) || out.count < 1 || !Number.isInteger(out.seedBase)) {
    throw new Error('usage: planted_cohort.mjs --out <dir> --count <n> --seed-base <int>');
  }
  return out;
}

// ------------------------------------------------------------------------ PRNG

/** mulberry32: small, seeded, and the same on every Node. */
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const chance = (p) => next() < p;
  const pick = (xs) => xs[Math.floor(next() * xs.length)];
  const shuffle = (xs) => {
    const c = [...xs];
    for (let i = c.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c;
  };
  return { next, int, chance, pick, shuffle };
}

/** Draw without replacement; reshuffle when the pool runs dry. */
function drawer(rng, pool) {
  let bag = [];
  return () => {
    if (bag.length === 0) bag = rng.shuffle(pool);
    return bag.pop();
  };
}

// ---------------------------------------------------------------------- prose

const TOWN_A = ['North', 'East', 'West', 'Lake', 'Cedar', 'Maple', 'Pine', 'River', 'Stone', 'Fair', 'Oak', 'Elm', 'Glen', 'Bright'];
const TOWN_B = ['field', 'brook', 'haven', 'ridge', 'port', 'wood', 'dale', 'ton', 'view', 'mont', 'ford', 'water'];
const KIND = ['Township', 'City', 'Village', 'County', 'Borough', 'Town'];
const DEPTS = ['Public Works', 'Finance', 'Parks and Recreation', 'Planning and Zoning', 'Human Resources', 'the Clerk\'s Office', 'Information Technology', 'Utilities'];

const GENERIC_SENTENCES = [
  'This section applies to all departments unless a later provision states otherwise.',
  'Questions about this material should be directed to {dept} during regular business hours.',
  'The information below reflects conditions as of the end of the {year} fiscal year.',
  'Staff will review these provisions annually and recommend changes where needed.',
  'Nothing in this section limits the authority of the governing body to act in an emergency.',
  'Where a deadline falls on a weekend or holiday, it moves to the next business day.',
  'Records supporting these figures are retained for at least {n} years.',
  'The {kind} coordinates this work with neighboring jurisdictions when practical.',
  'Residents may request copies of the supporting documents from {dept}.',
  'These amounts are estimates and may change as final invoices are received.',
  'Each responsible department reports progress to the administrator on a quarterly basis.',
  'Exceptions require written approval and must be documented in the project file.',
  'The following provisions were updated to reflect current state requirements.',
  'Approximately {n} percent of the work described here was completed on schedule.',
];

const GENERIC_H3 = ['Background', 'Purpose', 'Scope', 'Responsibilities', 'Procedures', 'Timeline', 'Funding Sources', 'Reporting Requirements', 'Exceptions', 'Definitions', 'Eligibility', 'Review Process', 'Implementation', 'Coordination With Other Agencies'];
const GENERIC_H4 = ['Notice Requirements', 'Documentation', 'Approval Authority', 'Appeals', 'Record Retention', 'Deadlines', 'Contact Information', 'Required Forms', 'Performance Measures', 'Cost Estimates', 'Public Comment', 'Staff Assignments', 'Training', 'Follow-Up Actions'];

const FAKE_HEADINGS = ['Please Note', 'Important Reminder', 'For Information Only', 'Action Required', 'Deadline Approaching', 'Staff Recommendation', 'Key Takeaway', 'Draft for Discussion'];
const BODY_LEVEL_TEXT = ['Note to the Reader', 'Sidebar: Frequently Asked Question', 'Callout: Where to Get Help', 'Summary Box', 'Staff Comment'];

const FAMILIES = [
  {
    slug: 'meeting-minutes',
    title: (t, y) => `${t} Council Regular Meeting Minutes, ${y}`,
    h2: ['Call to Order', 'Roll Call', 'Approval of the Agenda', 'Public Comment', 'Consent Agenda', 'Old Business', 'New Business', 'Department Reports', 'Council Comments', 'Adjournment'],
    h3: ['Motion to Approve', 'Discussion', 'Resolution Adopted', 'Budget Amendment Request', 'Street Resurfacing Update', 'Park Pavilion Rental Policy', 'Water Main Replacement', 'Library Board Appointment'],
    h4: ['Vote Recorded', 'Amendment Offered', 'Speakers', 'Staff Response', 'Follow-Up Requested'],
    sentences: [
      'The presiding officer called the meeting to order at {n}:00 p.m. in council chambers.',
      'A motion was made and seconded, and the motion carried by voice vote.',
      'Council members asked staff to return with a revised estimate at the next meeting.',
      'Two residents addressed council regarding traffic near the elementary school.',
      'The clerk confirmed that notice of the meeting was posted as required.',
      'The item was tabled until additional information is available.',
    ],
  },
  {
    slug: 'ordinance',
    title: (t, y) => `Ordinance No. ${y}-${String(t.length * 7).padStart(2, '0')}: Amending the ${t} Municipal Code`,
    h2: ['Findings', 'General Provisions', 'Definitions', 'Permits Required', 'Standards', 'Enforcement', 'Penalties', 'Severability', 'Effective Date', 'Repealer'],
    h3: ['Applicability', 'Application Contents', 'Fees', 'Inspections', 'Violations', 'Nonconforming Uses', 'Variances', 'Notice of Violation'],
    h4: ['First Offense', 'Subsequent Offenses', 'Cure Period', 'Hearing Procedure', 'Fee Waivers'],
    sentences: [
      'No person shall undertake the regulated activity without first obtaining a permit.',
      'The code official may issue a notice of violation describing the corrective action required.',
      'If any provision of this ordinance is held invalid, the remaining provisions remain in effect.',
      'This ordinance takes effect {n} days after its final passage and publication.',
      'The governing body finds that these amendments serve the public health, safety and welfare.',
      'Applications shall be submitted on forms provided by the {kind}.',
    ],
  },
  {
    slug: 'policy-manual',
    title: (t, y) => `${t} Administrative Policy Manual, Revised ${y}`,
    h2: ['Policy Statement', 'Authority', 'Travel and Expenses', 'Purchasing', 'Use of Technology', 'Records Management', 'Vehicle Use', 'Public Communications', 'Grant Administration', 'Policy Review'],
    h3: ['Approval Levels', 'Allowable Expenses', 'Prohibited Uses', 'Reimbursement', 'Data Security', 'Retention Schedule', 'Media Inquiries', 'Social Media'],
    h4: ['Mileage', 'Meals', 'Lodging', 'Passwords', 'Personal Devices', 'Disposal of Records'],
    sentences: [
      'Employees must obtain supervisor approval before incurring any reimbursable expense.',
      'Receipts must be submitted within {n} days of the expense.',
      'Devices issued by the {kind} remain its property and may be inspected at any time.',
      'Department heads are responsible for ensuring their staff understand this policy.',
      'This policy supersedes all prior versions and related memoranda.',
      'Violations may result in disciplinary action up to and including termination.',
    ],
  },
  {
    slug: 'annual-report',
    title: (t, y) => `${t} Annual Report to Residents, ${y}`,
    h2: ['Message From the Administrator', 'Year in Review', 'Financial Summary', 'Public Safety', 'Infrastructure', 'Parks and Community Services', 'Economic Development', 'Looking Ahead', 'Awards and Recognition', 'Directory'],
    h3: ['Revenues', 'Expenditures', 'Fund Balance', 'Police Department', 'Fire and Rescue', 'Roads and Bridges', 'Stormwater', 'Recreation Programs', 'New Businesses'],
    h4: ['Property Tax', 'Intergovernmental Revenue', 'Personnel Costs', 'Calls for Service', 'Response Times', 'Program Participation'],
    sentences: [
      'The {kind} ended the year with a balanced budget and a stable fund balance.',
      'Crews resurfaced {n} miles of local streets during the construction season.',
      'Recreation programs served more residents than in any prior year.',
      'Emergency response times remained within the adopted service standards.',
      'Several new businesses opened along the downtown corridor.',
      'We thank residents, volunteers and staff for their continued support.',
    ],
  },
  {
    slug: 'procurement-notice',
    title: (t, y) => `${t} Request for Proposals ${y}-${t.length}: Professional Services`,
    h2: ['Introduction', 'Scope of Services', 'Proposal Requirements', 'Evaluation Criteria', 'Schedule of Events', 'Insurance Requirements', 'Contract Terms', 'Submission Instructions', 'Questions and Addenda', 'Attachments'],
    h3: ['Project Description', 'Deliverables', 'Qualifications', 'Pricing', 'References', 'Interviews', 'Award', 'Protest Procedure'],
    h4: ['Minimum Coverage', 'Certificate of Insurance', 'Format', 'Page Limits', 'Late Submissions', 'Pre-Proposal Meeting'],
    sentences: [
      'Proposals must be received by the purchasing office no later than {n}:00 a.m. on the due date.',
      'The {kind} reserves the right to reject any or all proposals.',
      'Questions must be submitted in writing, and responses will be issued as addenda.',
      'Proposers shall describe their relevant experience on projects of similar size.',
      'The selected firm will be required to execute the standard professional services agreement.',
      'Evaluation will consider qualifications, approach, schedule and cost.',
    ],
  },
  {
    slug: 'employee-handbook',
    title: (t, y) => `${t} Employee Handbook, ${y} Edition`,
    h2: ['Welcome', 'Employment Basics', 'Compensation', 'Benefits', 'Leave', 'Workplace Conduct', 'Safety', 'Performance', 'Separation', 'Acknowledgment'],
    h3: ['Equal Opportunity', 'Probationary Period', 'Work Hours', 'Overtime', 'Health Insurance', 'Retirement', 'Vacation', 'Sick Leave', 'Harassment Prevention'],
    h4: ['Accrual Rates', 'Carryover', 'Eligibility Date', 'Reporting a Concern', 'Investigation', 'Payout on Separation'],
    sentences: [
      'Full-time employees accrue leave beginning on their first day of employment.',
      'Overtime must be approved in advance by the employee\'s supervisor.',
      'The {kind} prohibits discrimination and harassment of any kind.',
      'Employees should report workplace injuries to their supervisor immediately.',
      'Performance evaluations are completed at least once every {n} months.',
      'This handbook does not create a contract of employment.',
    ],
  },
  {
    slug: 'capital-plan',
    title: (t, y) => `${t} Capital Improvement Plan, ${y} to ${y + 5}`,
    h2: ['Executive Summary', 'Planning Process', 'Funding Overview', 'Transportation Projects', 'Water and Sewer Projects', 'Facilities', 'Parks Projects', 'Equipment Replacement', 'Unfunded Needs', 'Appendix'],
    h3: ['Project Ranking', 'Debt Capacity', 'Grants', 'Bridge Rehabilitation', 'Sidewalk Program', 'Treatment Plant Upgrades', 'Fire Station Renovation', 'Trail Extensions'],
    h4: ['Estimated Cost', 'Year Programmed', 'Operating Impact', 'Design Phase', 'Construction Phase', 'Funding Split'],
    sentences: [
      'Projects were ranked using criteria adopted by the governing body.',
      'The plan programs approximately {n} million dollars over the planning period.',
      'Operating costs associated with each project are estimated where known.',
      'Grant awards are assumed only where a commitment has been received.',
      'Projects beyond year two are subject to change as priorities are refined.',
      'The {kind} will seek low-interest loans for eligible utility projects.',
    ],
  },
  {
    slug: 'emergency-plan',
    title: (t, y) => `${t} Emergency Operations Plan, ${y} Update`,
    h2: ['Purpose and Scope', 'Situation and Assumptions', 'Concept of Operations', 'Organization and Responsibilities', 'Direction and Control', 'Communications', 'Administration and Logistics', 'Plan Maintenance', 'Hazard Annexes', 'Authorities and References'],
    h3: ['Hazard Analysis', 'Activation Levels', 'Emergency Operations Center', 'Evacuation', 'Sheltering', 'Public Warning', 'Mutual Aid', 'Damage Assessment'],
    h4: ['Severe Weather', 'Flooding', 'Hazardous Materials', 'Notification Procedures', 'Resource Requests', 'After-Action Review'],
    sentences: [
      'The emergency management coordinator activates this plan when conditions warrant.',
      'Department heads maintain call lists and review them at least every {n} months.',
      'Public warnings are issued through sirens, text alerts and local media.',
      'The {kind} may request mutual aid when local resources are exhausted.',
      'Shelters are opened in coordination with volunteer relief organizations.',
      'An after-action review is conducted following every activation.',
    ],
  },
];

const CUSTOM_IDS = ['SectionTitle', 'contactheading', 'SubsectionHead', 'ArticleHeading', 'TopicHeading'];

// ------------------------------------------------------------- XML helpers

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A styled paragraph whose own direct level 9 takes it out of the outline. */
const styledBodyOverride = (style, text) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:outlineLvl w:val="9"/></w:pPr>`
  + `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

/**
 * A table-of-contents field, as Word writes one: a title paragraph, then the
 * TOC field's cached result as TOC1..TOC3 paragraphs. The builders have no TOC
 * helper, so this is built here; the entry styles are undefined in styles.xml
 * (writeDocx has no slot for them), which leaves them at no outline level.
 */
function tocBlock(entries, titleStyle) {
  const out = [para('Contents', titleStyle)];
  entries.forEach((e, i) => {
    const begin = i === 0
      ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      : '';
    const end = i === entries.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : '';
    out.push(
      `<w:p><w:pPr><w:pStyle w:val="TOC${e.level}"/></w:pPr>${begin}`
      + `<w:r><w:t xml:space="preserve">${esc(e.text)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${e.page}</w:t></w:r>${end}</w:p>`,
    );
  });
  return out;
}

// --------------------------------------------------------------- one document

function buildDocument(i, seed, workRoot, realDir) {
  const rng = prng(seed);
  const family = FAMILIES[i % FAMILIES.length];
  const town = `${rng.pick(TOWN_A)}${rng.pick(TOWN_B)}`;
  const kind = rng.pick(KIND);
  const year = rng.int(2019, 2026);
  const place = `${town} ${kind}`;

  const fill = (s) => s
    .replace(/\{dept\}/g, rng.pick(DEPTS))
    .replace(/\{year\}/g, String(year))
    .replace(/\{n\}/g, String(rng.int(2, 12)))
    .replace(/\{kind\}/g, kind.toLowerCase());
  const sentence = drawer(rng, [...family.sentences, ...family.sentences, ...GENERIC_SENTENCES]);
  const bodyPara = () => para(Array.from({ length: rng.int(2, 3) }, () => fill(sentence())).join(' '));
  const h2Text = drawer(rng, family.h2);
  const h3Text = drawer(rng, [...family.h3, ...GENERIC_H3]);
  const h4Text = drawer(rng, [...family.h4, ...GENERIC_H4]);
  const fakeText = drawer(rng, FAKE_HEADINGS);
  const bodyLevelText = drawer(rng, BODY_LEVEL_TEXT);

  // Per-document switches.
  const numbered = rng.chance(0.4);
  const customLevel = rng.chance(0.7) ? rng.int(2, 4) : null;
  const customId = customLevel ? rng.pick(CUSTOM_IDS) : null;
  const directShare = rng.pick([0.1, 0.25, 0.5]);
  const withToc = rng.chance(0.3);
  const bodyLevelStyle = withToc
    ? { id: 'TOCHeading', basedOn: 'Heading1' }
    : rng.chance(0.5) ? { id: 'CalloutLabel', basedOn: `Heading${rng.int(2, 3)}` } : null;

  const declared = { H1: 0, H2: 0, H3: 0, H4: 0 };
  const mechanism = { style: 0, direct: 0, custom: 0 };
  const distractors = {
    fakeHeading: 0, headerTable: 0, toc: 0, imageHeadingDescribed: 0, imageHeadingUndescribed: 0,
    bodyLevelStyle: 0, bodyLevelDirect: 0, emptyHeading: 0, list: 0,
  };
  let figureId = 0;

  /** Declare one text heading through one of the three mechanisms. */
  const headingPara = (level, text) => {
    declared[`H${level}`] += 1;
    if (customLevel === level && rng.chance(0.4)) {
      mechanism.custom += 1;
      return para(text, customId);
    }
    if (rng.chance(directShare)) {
      mechanism.direct += 1;
      return outlinePara(level, text);
    }
    mechanism.style += 1;
    return heading(level, text);
  };

  // Plan the outline first so a TOC can list it.
  const sections = [];
  const nSections = rng.int(3, 6);
  for (let s = 1; s <= nSections; s += 1) {
    const sec = { text: numbered ? `${s}. ${h2Text()}` : h2Text(), subs: [] };
    const nSubs = rng.int(1, 3);
    for (let u = 1; u <= nSubs; u += 1) {
      const sub = { text: numbered ? `${s}.${u} ${h3Text()}` : h3Text(), subs: [] };
      if (rng.chance(0.4)) {
        const nLeaf = rng.int(1, 2);
        for (let l = 1; l <= nLeaf; l += 1) sub.subs.push(numbered ? `${s}.${u}.${l} ${h4Text()}` : h4Text());
      }
      sec.subs.push(sub);
    }
    sections.push(sec);
  }

  const body = [];
  const title = family.title(place, year);
  body.push(headingPara(1, title));
  body.push(bodyPara());

  if (withToc) {
    distractors.toc += 1;
    let page = 2;
    const entries = [];
    for (const sec of sections) {
      entries.push({ level: 1, text: sec.text, page: page });
      for (const sub of sec.subs) entries.push({ level: 2, text: sub.text, page: (page += rng.int(0, 1)) });
      page += 1;
    }
    body.push(...tocBlock(entries, 'TOCHeading'));
    distractors.bodyLevelStyle += 1;
    body.push(pageBreak());
  }

  const maybeDistractor = () => {
    const roll = rng.next();
    if (roll < 0.14) {
      distractors.fakeHeading += 1;
      body.push(fakeHeading(fakeText()), bodyPara());
    } else if (roll < 0.26) {
      distractors.headerTable += 1;
      const cols = rng.int(2, 4);
      const header = ['Item', 'Responsible Party', 'Amount', 'Status', 'Target Date'].slice(0, cols);
      const rows = [header];
      for (let r = 0; r < rng.int(2, 4); r += 1) {
        rows.push(header.map((h, c) => (c === 0 ? `${h2Text().split(' ')[0]} ${r + 1}` : `${rng.int(1, 90)}`)));
      }
      body.push(table(rows, { headerRow: true }));
    } else if (roll < 0.32) {
      distractors.list += 1;
      const numId = rng.int(1, 2);
      for (let k = 0; k < rng.int(2, 4); k += 1) body.push(listItem(numId, fill(sentence())));
    } else if (roll < 0.37 && bodyLevelStyle && !withToc) {
      distractors.bodyLevelStyle += 1;
      body.push(para(bodyLevelText(), bodyLevelStyle.id), bodyPara());
    } else if (roll < 0.41) {
      distractors.bodyLevelDirect += 1;
      body.push(styledBodyOverride(`Heading${rng.int(2, 4)}`, bodyLevelText()), bodyPara());
    } else if (roll < 0.44) {
      distractors.emptyHeading += 1;
      body.push(emptyOutlinePara(rng.int(2, 4)));
    }
  };

  /** An image-only heading at a level no deeper than the text heading just placed. */
  const maybeImageHeading = (level) => {
    if (!rng.chance(0.08)) return;
    figureId += 1;
    const described = rng.chance(0.5);
    if (described) distractors.imageHeadingDescribed += 1;
    else distractors.imageHeadingUndescribed += 1;
    body.push(
      figure(described ? `Photograph of the ${town} ${rng.pick(['municipal building', 'river crossing', 'community center', 'main street'])}` : null,
        { style: `Heading${level}`, id: figureId }),
      bodyPara(),
    );
  };

  for (const sec of sections) {
    body.push(headingPara(2, sec.text), bodyPara());
    maybeDistractor();
    maybeImageHeading(2);
    for (const sub of sec.subs) {
      body.push(headingPara(3, sub.text), bodyPara());
      maybeDistractor();
      maybeImageHeading(3);
      for (const leaf of sub.subs) {
        body.push(headingPara(4, leaf), bodyPara());
        if (rng.chance(0.5)) body.push(bodyPara());
        maybeDistractor();
      }
    }
  }

  const name = `c5-${String(i + 1).padStart(4, '0')}.docx`;
  writeDocx(join(workRoot, `${name}.parts`), join(realDir, name), {
    title,
    body,
    image: figureId > 0,
    ...(customId ? { customHeading: { id: customId, basedOn: `Heading${customLevel}` } } : {}),
    ...(bodyLevelStyle ? { bodyLevelStyle } : {}),
  });
  return { name, family: family.slug, seed, declared, mechanism, distractors };
}

// ------------------------------------------------------------------------ main

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out);
  const realDir = join(out, 'real');
  const workRoot = join(out, '.work');
  rmSync(realDir, { recursive: true, force: true });
  mkdirSync(realDir, { recursive: true });
  mkdirSync(workRoot, { recursive: true });

  const docs = [];
  for (let i = 0; i < args.count; i += 1) docs.push(buildDocument(i, args.seedBase + i, workRoot, realDir));
  rmSync(workRoot, { recursive: true, force: true });

  const names = [
    '# cohort 5 - planted Word cohort for heading-type training (synthetic; ruling P1-P3)',
    `# <id>.docx\\t<url>; url is https://planted-<family>.invalid/<seed>; --count ${args.count} --seed-base ${args.seedBase}`,
    ...docs.map((d) => `${d.name}\thttps://planted-${d.family}.invalid/${d.seed}`),
  ];
  writeFileSync(join(out, 'real-names.txt'), `${names.join('\n')}\n`);

  const sum = (key) => docs.reduce((acc, d) => {
    for (const [k, v] of Object.entries(d[key])) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  const families = docs.reduce((acc, d) => ({ ...acc, [d.family]: (acc[d.family] ?? 0) + 1 }), {});
  console.log(JSON.stringify({
    documents: docs.length,
    declared: sum('declared'),
    mechanism: sum('mechanism'),
    distractors: sum('distractors'),
    families,
    perDocument: docs.map((d) => ({ name: d.name, ...d.declared })),
  }));
}

main();
