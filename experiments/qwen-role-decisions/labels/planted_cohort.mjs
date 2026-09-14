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
 * Usage: node planted_cohort.mjs --out <dir> --count 100 --seed-base <int> [--cohort c5|c7]
 * Output: <out>/real/<cohort>-NNNN.docx and <out>/real-names.txt (P2 URL shape).
 *
 * c5 (the default) is the round-3 cohort and regenerates byte-for-byte from
 * its original arguments. Its heading surfaces were uniform (bold 0.99, Title
 * Case 0.87, ALL CAPS 0.00, 12 pt) and the adapter learned that form (S23).
 * c7 keeps c5's structure — ladder, declaration mechanisms, distractors — and
 * draws every heading's surface per template family: bold or not, 11-18 pt,
 * Title/Sentence/ALL CAPS, family numbering (`3.2`, `ARTICLE IV`, `Section
 * 4.1`, `(a)`), carried as run properties that override the style's rPr.
 * Distractors get the same surfaces, so bold does not imply heading.
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
  const out = { out: null, count: 100, seedBase: null, cohort: 'c5' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--out') out.out = argv[++i];
    else if (k === '--count') out.count = Number(argv[++i]);
    else if (k === '--seed-base') out.seedBase = Number(argv[++i]);
    else if (k === '--cohort') out.cohort = argv[++i];
    else throw new Error(`unknown argument ${k}`);
  }
  if (!out.out || !Number.isInteger(out.count) || out.count < 1 || !Number.isInteger(out.seedBase)) {
    throw new Error('usage: planted_cohort.mjs --out <dir> --count <n> --seed-base <int> [--cohort c5|c7]');
  }
  if (!Object.hasOwn(COHORTS, out.cohort)) throw new Error(`unknown cohort ${out.cohort}`);
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

// ----------------------------------------------------------- c7 surfaces

/**
 * Per-family heading surface for c7. `bold` and `pt` ([lo, hi]) are per level
 * H1..H4; `cases` is [Title, Sentence, ALL CAPS] weights per level; `scheme`
 * is the family's numbering, used in a `numbered` share of its documents;
 * `colon` is the share of headings written with a trailing colon.
 * Calibrated so the matched H rows pool to the real train rows (r4-T2).
 */
const SURFACE_C7 = {
  'meeting-minutes': {
    numbered: 0.6, scheme: 'roman-alpha', colon: 0.08,
    bold: [1, 0.75, 0.55, 0.35], pt: [[14, 16], [12, 14], [11, 13], [11, 12]],
    cases: [[0.4, 0, 0.6], [0.2, 0.2, 0.6], [0.6, 0.25, 0.15], [0.5, 0.4, 0.1]],
  },
  ordinance: {
    numbered: 0.9, scheme: 'article', colon: 0.02,
    bold: [1, 0.95, 0.75, 0.4], pt: [[14, 18], [13, 16], [12, 14], [11, 12]],
    cases: [[0.3, 0, 0.7], [0.1, 0.1, 0.8], [0.75, 0.15, 0.1], [0.45, 0.55, 0]],
  },
  'policy-manual': {
    numbered: 0.7, scheme: 'decimal', colon: 0,
    bold: [1, 0.9, 0.8, 0.6], pt: [[16, 18], [14, 16], [12, 14], [11, 13]],
    cases: [[0.9, 0, 0.1], [0.7, 0.2, 0.1], [0.6, 0.2, 0.2], [0.55, 0.35, 0.1]],
  },
  'annual-report': {
    numbered: 0.1, scheme: 'decimal', colon: 0,
    bold: [0.8, 0.7, 0.65, 0.55], pt: [[17, 18], [16, 18], [14, 16], [12, 14]],
    cases: [[0.6, 0, 0.4], [0.4, 0.2, 0.4], [0.55, 0.25, 0.2], [0.55, 0.35, 0.1]],
  },
  'procurement-notice': {
    numbered: 0.8, scheme: 'section', colon: 0.03,
    bold: [1, 0.95, 0.8, 0.55], pt: [[14, 16], [12, 14], [11, 13], [11, 12]],
    cases: [[0.3, 0, 0.7], [0.2, 0.1, 0.7], [0.7, 0.2, 0.1], [0.55, 0.45, 0]],
  },
  'employee-handbook': {
    numbered: 0.3, scheme: 'decimal', colon: 0.05,
    bold: [0.9, 0.75, 0.65, 0.5], pt: [[16, 18], [14, 16], [13, 14], [12, 13]],
    cases: [[0.7, 0, 0.3], [0.3, 0.4, 0.3], [0.35, 0.45, 0.2], [0.35, 0.5, 0.15]],
  },
  'capital-plan': {
    numbered: 0.5, scheme: 'decimal', colon: 0,
    bold: [1, 0.85, 0.7, 0.5], pt: [[16, 18], [14, 17], [13, 15], [12, 14]],
    cases: [[0.8, 0, 0.2], [0.7, 0.1, 0.2], [0.6, 0.2, 0.2], [0.6, 0.25, 0.15]],
  },
  'emergency-plan': {
    numbered: 0.6, scheme: 'section', colon: 0.03,
    bold: [1, 0.8, 0.6, 0.35], pt: [[14, 18], [13, 16], [12, 14], [11, 12]],
    cases: [[0.3, 0, 0.7], [0.25, 0.1, 0.65], [0.65, 0.25, 0.1], [0.5, 0.45, 0.05]],
  },
};

/**
 * c7's longer headings (2-6 words), written for the families, drawn beside the
 * c5 pools so heading length matches real documents (median 3 words) rather
 * than c5's 2. Keyed by family slug; GENERIC rows join every family's H3/H4.
 */
/** Every word capitalised, the "Title Case" Word's Change Case writes. */
const allCaps1 = (pools) => Object.fromEntries(Object.entries(pools).map(([k, v]) => [k, v.map((t) => t.replace(/(^|[\s-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase()))]));

const LONG_C7 = Object.fromEntries(Object.entries({
  'meeting-minutes': {
    h2: ['Presentations and Special Recognitions', 'Reports of Standing Committees', 'Items Removed From the Consent Agenda', 'Public Hearing on Proposed Rezoning', 'Closed Session Report Out', 'Future Agenda Items and Scheduling'],
    h3: ['Motion to Award the Paving Contract', 'Update on the Downtown Parking Study', 'Request to Waive Permit Fees', 'Second Reading of the Noise Ordinance', 'Report From the Finance Director', 'Appointment to the Planning Commission', 'Discussion of Summer Event Permits'],
    h4: ['Roll Call Vote Results', 'Comments From the Public', 'Staff Answers to Council Questions', 'Direction Given to Staff'],
  },
  ordinance: {
    h2: ['Purpose and Legislative Intent', 'Administration and Enforcement Authority', 'Permit Application and Review', 'Appeals to the Board of Adjustment', 'Transitional Provisions for Existing Uses', 'Conflicts With Other Ordinances'],
    h3: ['Duties of the Code Official', 'Contents of a Complete Application', 'Schedule of Permit Fees', 'Right of Entry for Inspections', 'Issuance of Stop Work Orders', 'Expiration and Renewal of Permits', 'Standards for Granting a Variance'],
    h4: ['Notice to the Property Owner', 'Time Allowed to Correct', 'Civil Penalties for Continuing Violations', 'Filing an Appeal'],
  },
  'policy-manual': {
    h2: ['Purchasing Thresholds and Bid Requirements', 'Acceptable Use of Technology Resources', 'Travel Authorization and Reimbursement', 'Records Retention and Public Requests', 'Use of Municipal Vehicles', 'Communications With the News Media'],
    h3: ['Who May Approve a Purchase', 'Emergency Purchases Without Bids', 'Expenses That Are Not Reimbursed', 'Protecting Sensitive Personal Data', 'Responding to a Records Request', 'Posting on Official Social Accounts', 'Assignment of Take-Home Vehicles'],
    h4: ['Daily Meal Allowance Rates', 'Password and Login Rules', 'Lost or Stolen Devices', 'Required Receipts and Forms'],
  },
  'annual-report': {
    h2: ['A Letter From the Mayor', 'Where Your Tax Dollars Went', 'Keeping Our Community Safe', 'Investing in Roads and Utilities', 'Programs for Families and Seniors', 'Growing the Local Economy'],
    h3: ['General Fund Revenue by Source', 'Spending by Department', 'Police Calls for Service', 'Fire Department Response Times', 'Streets Resurfaced This Year', 'New Park Facilities Opened', 'Business Licenses Issued'],
    h4: ['Comparison to Last Year', 'How We Measure Results', 'Goals for the Coming Year', 'Resident Survey Highlights'],
  },
  'procurement-notice': {
    h2: ['Background and Project Goals', 'Minimum Qualifications of Proposers', 'Contents of the Proposal Package', 'Evaluation and Selection Process', 'Tentative Schedule of Key Dates', 'General Terms and Conditions'],
    h3: ['Description of Required Services', 'Expected Project Deliverables', 'Key Personnel and Experience', 'Cost Proposal Format', 'Client References From Similar Work', 'Oral Interviews With Finalists', 'Notice of Intent to Award'],
    h4: ['Required Insurance Limits', 'Formatting and Page Limits', 'Where to Deliver Proposals', 'Conflict of Interest Disclosure'],
  },
  'employee-handbook': {
    h2: ['About Working for Us', 'Hiring and Employment Status', 'Pay Periods and Timekeeping', 'Health and Retirement Benefits', 'Time Off and Leaves of Absence', 'Standards of Workplace Conduct'],
    h3: ['Your Introductory Period', 'Recording Hours Worked', 'When Overtime Is Paid', 'Enrolling in Health Coverage', 'Using Vacation Leave', 'Family and Medical Leave', 'How to Report Harassment'],
    h4: ['How Leave Accrues', 'Carrying Over Unused Leave', 'What Happens After a Report', 'Leave Payout When You Leave'],
  },
  'capital-plan': {
    h2: ['How Projects Are Selected', 'Five-Year Funding Summary', 'Street and Bridge Projects', 'Water and Wastewater Improvements', 'Public Building Renovations', 'Needs Without Identified Funding'],
    h3: ['Criteria Used to Rank Projects', 'Outstanding Debt and Borrowing Capacity', 'State and Federal Grant Sources', 'Main Street Bridge Repairs', 'Citywide Sidewalk Gap Program', 'Treatment Plant Capacity Upgrade', 'Renovation of Fire Station Two'],
    h4: ['Total Estimated Project Cost', 'Annual Operating Cost Impact', 'Design and Engineering Phase', 'Sources of Project Funding'],
  },
  'emergency-plan': {
    h2: ['Purpose, Scope and Assumptions', 'How This Plan Is Activated', 'Roles of Each Department', 'Emergency Public Information', 'Resource Management and Logistics', 'Training, Exercises and Updates'],
    h3: ['Hazards Most Likely to Occur', 'Levels of Plan Activation', 'Opening the Operations Center', 'Evacuation Routes and Procedures', 'Opening Emergency Shelters', 'Sending Public Warnings', 'Requesting Mutual Aid'],
    h4: ['Severe Storm Response', 'Flood Warning Procedures', 'Chemical Spill Notification', 'After-Action Report Process'],
  },
  GENERIC: {
    h3: ['Purpose of This Section', 'Who This Applies To', 'Roles and Responsibilities', 'Steps in the Process', 'Reporting and Recordkeeping'],
    h4: ['Required Notices', 'Who Approves Changes', 'How to Appeal', 'Contact for Questions'],
  },
}).map(([slug, pools]) => [slug, allCaps1(pools)]));

/** Distractors that look like headings: the same surface space, no outline level. */
const DISTRACTOR_SURFACE_C7 = { bold: 0.6, pt: [11, 20], cases: [0.45, 0.25, 0.3] };

const COHORTS = {
  c5: { id: 'c5', header: '# cohort 5 - planted Word cohort for heading-type training (synthetic; ruling P1-P3)', surface: null },
  c7: { id: 'c7', header: '# cohort 7 - planted Word cohort with varied heading surfaces (synthetic; ruling P1-P3, P9, S23)', surface: SURFACE_C7 },
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const ALPHA = 'abcdefghij';

const sentenceCase = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

function weighted(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** Apply a case to the heading words; ALL CAPS also takes the number with it. */
function cased(caseIdx, prefix, words) {
  const w = caseIdx === 1 ? sentenceCase(words) : words;
  const full = prefix ? `${prefix} ${w}` : w;
  return caseIdx === 2 ? full.toUpperCase() : full;
}

/** A family's number for a heading at `level` (2-4) at position s.u.l. */
function numberFor(scheme, level, s, u, l) {
  const forms = {
    article: [() => `ARTICLE ${ROMAN[s - 1]}`, () => `Section ${s}.${u}`, () => `(${ALPHA[l - 1]})`],
    section: [() => `Section ${s}`, () => `${s}.${u}`, () => `(${ALPHA[l - 1]})`],
    'roman-alpha': [() => `${ROMAN[s - 1]}.`, () => `${ALPHA[u - 1].toUpperCase()}.`, () => `${l}.`],
    decimal: [() => `${s}.`, () => `${s}.${u}`, () => `${s}.${u}.${l}`],
  };
  return forms[scheme][level - 2]();
}

/** Run properties that override whatever the paragraph's style says. */
const rPr = ({ bold, pt }) =>
  `<w:rPr>${bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>'}<w:sz w:val="${pt * 2}"/><w:szCs w:val="${pt * 2}"/></w:rPr>`;

/** Put the surface on every text run of a builder-made paragraph. */
const withSurface = (xml, surface) => (surface ? xml.replace(/<w:r><w:t/g, `<w:r>${rPr(surface)}<w:t`) : xml);

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

function buildDocument(i, seed, workRoot, realDir, cohort) {
  const rng = prng(seed);
  // c7 surface draws come from their own stream, so c5's draws are untouched.
  const srng = prng((seed ^ 0x7c7c7c7) >>> 0);
  const profile = cohort.surface ? cohort.surface[FAMILIES[i % FAMILIES.length].slug] : null;
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
  const long = profile ? LONG_C7[family.slug] : null;
  const h2Text = drawer(rng, long ? [...family.h2, ...long.h2] : family.h2);
  const h3Text = drawer(rng, long ? [...family.h3, ...long.h3, ...long.h3, ...LONG_C7.GENERIC.h3] : [...family.h3, ...GENERIC_H3]);
  const h4Text = drawer(rng, long ? [...family.h4, ...long.h4, ...long.h4, ...LONG_C7.GENERIC.h4] : [...family.h4, ...GENERIC_H4]);
  const fakeText = drawer(rng, FAKE_HEADINGS);
  const bodyLevelText = drawer(rng, BODY_LEVEL_TEXT);

  // Per-document switches.
  const numbered = profile ? (rng.chance(0.4), srng.chance(profile.numbered)) : rng.chance(0.4);
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
    ...(profile ? { boldSentence: 0 } : {}),
  };
  let figureId = 0;

  /** Declare one text heading through one of the three mechanisms. */
  const headingPara = (level, text, surface = null) => {
    declared[`H${level}`] += 1;
    if (customLevel === level && rng.chance(0.4)) {
      mechanism.custom += 1;
      return withSurface(para(text, customId), surface);
    }
    if (rng.chance(directShare)) {
      mechanism.direct += 1;
      return withSurface(outlinePara(level, text), surface);
    }
    mechanism.style += 1;
    return withSurface(heading(level, text), surface);
  };

  /** c7: one heading's text and surface, drawn from the family profile. */
  const surfaced = (level, words, prefix) => {
    if (!profile) return { text: prefix ? `${prefix} ${words}` : words, surface: null };
    const [lo, hi] = profile.pt[level - 1];
    const surface = { bold: srng.chance(profile.bold[level - 1]), pt: srng.int(lo, hi) };
    let text = cased(weighted(srng, profile.cases[level - 1]), prefix, words);
    if (level > 1 && srng.chance(profile.colon)) text += ':';
    return { text, surface };
  };
  /** c7: a distractor that wears a heading surface. */
  const distractorSurface = (words) => {
    const d = DISTRACTOR_SURFACE_C7;
    return { text: cased(weighted(srng, d.cases), null, words), surface: { bold: srng.chance(d.bold), pt: srng.int(d.pt[0], d.pt[1]) } };
  };

  // Plan the outline first so a TOC can list it.
  const sections = [];
  const nSections = rng.int(3, 6);
  const scheme = profile ? profile.scheme : null;
  const num = (level, s, u, l) => (numbered && profile ? numberFor(scheme, level, s, u, l) : null);
  for (let s = 1; s <= nSections; s += 1) {
    const sec = profile
      ? { ...surfaced(2, h2Text(), num(2, s)), subs: [] }
      : { text: numbered ? `${s}. ${h2Text()}` : h2Text(), subs: [] };
    const nSubs = rng.int(1, 3);
    for (let u = 1; u <= nSubs; u += 1) {
      const sub = profile
        ? { ...surfaced(3, h3Text(), num(3, s, u)), subs: [] }
        : { text: numbered ? `${s}.${u} ${h3Text()}` : h3Text(), subs: [] };
      if (rng.chance(0.4)) {
        const nLeaf = rng.int(1, 2);
        for (let l = 1; l <= nLeaf; l += 1) {
          sub.subs.push(profile ? surfaced(4, h4Text(), num(4, s, u, l)) : numbered ? `${s}.${u}.${l} ${h4Text()}` : h4Text());
        }
      }
      sec.subs.push(sub);
    }
    sections.push(sec);
  }

  const body = [];
  const title = family.title(place, year);
  const top = surfaced(1, title, null);
  body.push(headingPara(1, top.text, top.surface));
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
      if (profile) {
        const d = distractorSurface(fakeText());
        body.push(`<w:p><w:r>${rPr(d.surface)}<w:t xml:space="preserve">${esc(d.text)}</w:t></w:r></w:p>`, bodyPara());
      } else body.push(fakeHeading(fakeText()), bodyPara());
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
      if (profile) {
        const d = distractorSurface(bodyLevelText());
        body.push(withSurface(para(d.text, bodyLevelStyle.id), d.surface), bodyPara());
      } else body.push(para(bodyLevelText(), bodyLevelStyle.id), bodyPara());
    } else if (roll < 0.41) {
      distractors.bodyLevelDirect += 1;
      if (profile) {
        const style = `Heading${rng.int(2, 4)}`;
        const d = distractorSurface(bodyLevelText());
        body.push(withSurface(styledBodyOverride(style, d.text), d.surface), bodyPara());
      } else body.push(styledBodyOverride(`Heading${rng.int(2, 4)}`, bodyLevelText()), bodyPara());
    } else if (roll < 0.44) {
      distractors.emptyHeading += 1;
      body.push(emptyOutlinePara(rng.int(2, 4)));
    } else if (profile && roll < 0.54) {
      // c7 only: a bold (or plain) one-sentence body paragraph, so bold is not a heading cue.
      distractors.boldSentence += 1;
      body.push(withSurface(para(fill(sentence())), { bold: srng.chance(0.7), pt: srng.int(11, 12) }), bodyPara());
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
    body.push(headingPara(2, sec.text, sec.surface), bodyPara());
    maybeDistractor();
    maybeImageHeading(2);
    for (const sub of sec.subs) {
      body.push(headingPara(3, sub.text, sub.surface), bodyPara());
      maybeDistractor();
      maybeImageHeading(3);
      for (const leaf of sub.subs) {
        body.push(profile ? headingPara(4, leaf.text, leaf.surface) : headingPara(4, leaf), bodyPara());
        if (rng.chance(0.5)) body.push(bodyPara());
        maybeDistractor();
      }
    }
  }

  const name = `${cohort.id}-${String(i + 1).padStart(4, '0')}.docx`;
  writeDocx(join(workRoot, `${name}.parts`), join(realDir, name), {
    title: top.text,
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
  const cohort = COHORTS[args.cohort];
  for (let i = 0; i < args.count; i += 1) docs.push(buildDocument(i, args.seedBase + i, workRoot, realDir, cohort));
  rmSync(workRoot, { recursive: true, force: true });

  const names = [
    cohort.header,
    `# <id>.docx\\t<url>; url is https://planted-<family>.invalid/<seed>; --count ${args.count} --seed-base ${args.seedBase}${cohort.id === 'c5' ? '' : ` --cohort ${cohort.id}`}`,
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
