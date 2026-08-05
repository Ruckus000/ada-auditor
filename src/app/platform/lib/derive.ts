/**
 * Pure derivations behind the platform screens.
 *
 * Every number the interface shows — must-fix counts, verdict wording, journey
 * ribbons, filter counts — is computed here from the fixture data plus the
 * operator's in-session overrides. Keeping it out of the components means the
 * claims the screens make ("2 must fix", "first breaks at step 3") are testable
 * without a DOM.
 */

import {
  ACTIVITY_CLIENT_NAMES,
  ACTIVITY_DAYS,
  CLIENT_EXTRAS,
  CONFIG_BY_CLIENT,
  CRITERION_SETS,
  FINDINGS_BY_CLIENT,
  FIX_SETS,
  JOURNEY_DEFS,
  LINK_NOTES,
  LINK_STATES,
  REPORT_DEFS,
  SITE_SEEDS,
  VIEWERS_BY_CLIENT,
  WCAG_NAMES,
  type ActivityRowSeed,
  type Audience,
  type DiffKind,
  type FindingRecord,
  type FindingStatus,
  type Severity,
  type StepKind,
  type VerdictKind,
} from './data';

/* -------------------------------------------------------------- skins --- */

export interface Chip {
  chipBg: string;
  chipColor: string;
  chipBorder: string;
  chipLabel: string;
}

const CHIPS: Record<VerdictKind, Chip> = {
  fail: { chipBg: '#96231c', chipColor: '#fff', chipBorder: '#96231c', chipLabel: '✕ FAIL' },
  risk: { chipBg: '#fdf3e2', chipColor: '#7a4e0a', chipBorder: '#dfba79', chipLabel: '! AT RISK' },
  pass: { chipBg: '#e3efec', chipColor: '#0b5f58', chipBorder: '#bcd9d2', chipLabel: '✓ PASS' },
  scan: { chipBg: '#eef1f6', chipColor: '#37507e', chipBorder: '#c9d3e5', chipLabel: '◌ SCANNING' },
};

export const chip = (k: VerdictKind): Chip => CHIPS[k];

export interface SevSkin {
  sev: string;
  sevBg: string;
  sevColor: string;
  sevBorder: string;
}

export const SEV_SKIN: Record<Severity, SevSkin> = {
  must: { sev: 'MUST FIX', sevBg: '#96231c', sevColor: '#fff', sevBorder: '#96231c' },
  should: { sev: 'SHOULD FIX', sevBg: '#fdf3e2', sevColor: '#7a4e0a', sevBorder: '#dfba79' },
  nice: { sev: 'NICE TO FIX', sevBg: '#f3efe6', sevColor: '#55636b', sevBorder: '#ddd6c8' },
};

const STATUS_COLOR: Record<FindingStatus, string> = {
  Open: '#3a464e',
  Assigned: '#37507e',
  'Retest due': '#7a4e0a',
  Dismissed: '#55636b',
  Fixed: '#0b5f58',
};

export const VERDICT_HEAD: Record<VerdictKind, string> = {
  fail: 'Does not conform',
  risk: 'Partially conforms',
  pass: 'Conforms',
  scan: 'Still testing',
};

export const VERDICT_WORD: Record<VerdictKind, string> = {
  fail: 'DOES NOT CONFORM',
  risk: 'PARTIALLY CONFORMS',
  pass: 'CONFORMS',
  scan: 'RUN IN PROGRESS',
};

export const VERDICT_TONE: Record<VerdictKind, string> = {
  fail: '#96231c',
  risk: '#7a4e0a',
  pass: '#0b5f58',
  scan: '#37507e',
};

const BANNER_SKIN: Record<VerdictKind, [string, string]> = {
  fail: ['#fdf6f5', '#e6b3ae'],
  risk: ['#fdf9f1', '#dfba79'],
  pass: ['#f2f8f6', '#bcd9d2'],
  scan: ['#eef1f6', '#c9d3e5'],
};

const DIFF_SKIN: Record<DiffKind, { label: string; note: string; bg: string; border: string; color: string }> = {
  new: { label: 'new findings', note: 'Appeared in this run', bg: '#fdf6f5', border: '#e6b3ae', color: '#96231c' },
  fixed: { label: 'fixed', note: 'Confirmed by re-test', bg: '#f2f8f6', border: '#bcd9d2', color: '#0b5f58' },
  regressed: { label: 'came back', note: 'Fixed before, broken again', bg: '#fdf9f1', border: '#dfba79', color: '#7a4e0a' },
};

const STEP_STYLE: Record<StepKind, { dot: string; bg: string; border: string; noteColor: string; noteWeight: number }> = {
  block: { dot: '#96231c', bg: '#fdf6f5', border: '#e6b3ae', noteColor: '#96231c', noteWeight: 650 },
  hard: { dot: '#7a4e0a', bg: '#fdf9f1', border: '#e8dcc2', noteColor: '#7a4e0a', noteWeight: 600 },
  ok: { dot: '#0b5f58', bg: '#f9f7f1', border: '#ece7dc', noteColor: '#55636b', noteWeight: 400 },
};

const RIBBON_BG: Record<StepKind, string> = { block: '#96231c', hard: '#dfba79', ok: '#bcd9d2' };

export const scoreColor = (kind: VerdictKind, score: number): string =>
  kind === 'scan' ? '#55636b' : score >= 85 ? '#0b5f58' : score >= 70 ? '#7a4e0a' : '#96231c';

/* --------------------------------------------------------- overrides --- */

/** Finding-status changes made in this session, keyed by client then index. */
export type FindingOverrides = Record<string, Record<number, FindingStatus>>;

export function findingsFor(clientName: string, overrides: FindingOverrides): FindingRecord[] {
  const forClient = overrides[clientName] ?? {};
  return (FINDINGS_BY_CLIENT[clientName] ?? []).map((record, i) =>
    forClient[i] ? { ...record, status: forClient[i] } : record,
  );
}

const isOpen = (r: FindingRecord) => r.status !== 'Dismissed';

/* ------------------------------------------------------------- sites --- */

export interface SiteView extends Chip {
  index: number;
  name: string;
  domain: string;
  kind: VerdictKind;
  score: number | '—';
  scoreColor: string;
  must: number;
  should: number;
  pages: number;
  owner: string;
  last: string;
  next: string;
  worst: string;
  delta: string;
  deltaLong: string;
  deltaColor: string;
  mustColor: string;
  flagged: boolean;
  flag: string;
}

export function siteViews(overrides: FindingOverrides): SiteView[] {
  return SITE_SEEDS.map((seed, index) => {
    const up = seed.delta.startsWith('+');
    const open = findingsFor(seed.name, overrides).filter(isOpen);
    const must = open.filter((r) => r.severity === 'must').length;
    const should = open.filter((r) => r.severity === 'should').length;
    return {
      index,
      name: seed.name,
      domain: seed.domain,
      kind: seed.kind,
      score: seed.kind === 'scan' ? '—' : seed.score,
      scoreColor: scoreColor(seed.kind, seed.score),
      must,
      should,
      pages: seed.pages,
      owner: seed.owner,
      last: seed.last,
      next: seed.next,
      worst: seed.worst,
      delta: seed.delta,
      deltaLong:
        seed.kind === 'scan'
          ? 'still running'
          : seed.delta === '0'
            ? 'no change'
            : seed.delta + (seed.delta.slice(1) === '1' ? ' point' : ' points'),
      deltaColor: up ? '#0b5f58' : seed.delta === '—' || seed.delta === '0' ? '#55636b' : '#96231c',
      mustColor: must > 0 ? '#96231c' : '#55636b',
      flagged: Boolean(seed.flag),
      flag: seed.flag,
      ...chip(seed.kind),
    };
  });
}

/* ------------------------------------------------------------ client --- */

export interface DiffTile {
  n: number;
  label: string;
  note: string;
  bg: string;
  border: string;
  color: string;
}

export interface RunRow {
  id: number;
  score: number | '—';
  delta: string;
  when: string;
  bg: string;
  scoreColor: string;
  deltaColor: string;
}

export interface BlockingRow {
  what: string;
  file: string;
  scope: string;
  who: string;
  findingIndex: number;
}

export interface ClientView extends SiteView {
  standard: string;
  run: number;
  prevRun: number;
  runCount: number;
  journeyCount: number;
  verdictHead: string;
  verdictBody: string;
  bannerBg: string;
  bannerBorder: string;
  ringGradient: string;
  diff: DiffTile[];
  runs: RunRow[];
  coverage: Array<{ label: string; n: number; color: string }>;
  hasSkipped: boolean;
  reportState: string;
  genWarning: string;
  blocking: BlockingRow[];
  hasBlocking: boolean;
}

export function clientView(siteIndex: number, overrides: FindingOverrides): ClientView {
  const site = siteViews(overrides)[siteIndex];
  const ex = CLIENT_EXTRAS[site.name];
  const all = findingsFor(site.name, overrides);
  const open = all.filter(isOpen);
  const nMust = open.filter((r) => r.severity === 'must').length;

  const blocking: BlockingRow[] = open
    .filter((r) => r.severity === 'must')
    .map((r) => ({
      what: r.what,
      file: `WCAG ${r.wcag}`,
      scope: `${r.pages} · ${r.status}`,
      who: site.owner,
      findingIndex: all.findIndex((candidate) => candidate.what === r.what),
    }));

  const lead =
    site.kind === 'scan'
      ? 'This run is still going. '
      : nMust > 0
        ? `${nMust} ${nMust === 1 ? 'finding blocks' : 'findings block'} conformance today. `
        : 'Nothing blocks conformance today. ';

  return {
    ...site,
    standard: ex.standard,
    run: ex.run,
    prevRun: ex.prevRun,
    runCount: ex.runCount,
    journeyCount: ex.journeyCount,
    verdictHead: VERDICT_HEAD[site.kind],
    verdictBody: lead + ex.body,
    bannerBg: BANNER_SKIN[site.kind][0],
    bannerBorder: BANNER_SKIN[site.kind][1],
    ringGradient: `conic-gradient(${site.scoreColor} ${site.kind === 'scan' ? 0 : SITE_SEEDS[siteIndex].score}%, #e2ddd0 0)`,
    diff: ex.diff.map(([n, k]) => ({ n, ...DIFF_SKIN[k] })),
    runs: ex.runs.map(([id, score, delta, when], i) => ({
      id,
      score: score || '—',
      delta,
      when,
      bg: i === 0 ? '#f2f8f6' : 'transparent',
      scoreColor: !score ? '#55636b' : score >= 85 ? '#0b5f58' : score >= 70 ? '#7a4e0a' : '#96231c',
      deltaColor: delta.indexOf('+') === 0 ? '#0b5f58' : delta === '0' || delta === '—' ? '#55636b' : '#96231c',
    })),
    coverage: [
      { label: 'Pages tested', n: site.pages - ex.skipped, color: '#0b5f58' },
      { label: 'Pages skipped', n: ex.skipped, color: '#7a4e0a' },
      { label: 'Journeys walked', n: ex.journeyCount, color: '#37507e' },
    ],
    hasSkipped: ex.skipped > 0,
    reportState: ex.report,
    genWarning:
      site.must > 0
        ? `${site.must} must-fix findings are still open, so this report will carry a “does not conform” verdict. Dismissed findings stay counted as unresolved.`
        : 'No findings block conformance. The report will state that automated checks detect roughly 40% of barriers and that a manual review is recommended.',
    blocking,
    hasBlocking: blocking.length > 0,
  };
}

/* ---------------------------------------------------------- journeys --- */

export interface JourneyStep {
  label: string;
  kind: StepKind;
  note: string;
  num: number;
  dot: string;
  bg: string;
  border: string;
  noteColor: string;
  noteWeight: number;
}

export type JourneyItem =
  | ({ isGap: false } & JourneyStep)
  | { isGap: true; label: string; range: string };

export interface JourneyView extends Chip {
  name: string;
  site: string;
  summary: string;
  footer: string;
  items: JourneyItem[];
  stepCount: number;
  ribbon: Array<{ bg: string; h: string; title: string }>;
  firstBreak: string;
  firstBreakColor: string;
  canToggle: boolean;
  toggleLabel: string;
  key: string;
}

export function journeysFor(clientName: string, expanded: Record<string, boolean>): JourneyView[] {
  return JOURNEY_DEFS.filter((j) => j.site === clientName).map((def) => {
    const key = `${clientName}·${def.name}`;
    const steps: JourneyStep[] = def.steps.map(([label, kind, note], i) => ({
      label,
      kind,
      note,
      num: i + 1,
      ...STEP_STYLE[kind],
    }));

    const open = Boolean(expanded[key]);
    // Long journeys hide runs of clean steps so the breaks stay adjacent on
    // screen; short ones are always shown whole.
    const canToggle = def.steps.length > 6 && steps.some((s) => s.kind === 'ok');

    let items: JourneyItem[];
    if (open || !canToggle) {
      items = steps.map((s) => ({ ...s, isGap: false as const }));
    } else {
      items = [];
      let run: JourneyStep[] = [];
      const flush = () => {
        if (!run.length) return;
        if (run.length >= 3) {
          items.push({
            isGap: true,
            label: `${run.length} clean steps`,
            range: `${run[0].num}–${run[run.length - 1].num}`,
          });
        } else {
          run.forEach((s) => items.push({ ...s, isGap: false as const }));
        }
        run = [];
      };
      steps.forEach((s) => {
        if (s.kind === 'ok') {
          run.push(s);
        } else {
          flush();
          items.push({ ...s, isGap: false as const });
        }
      });
      flush();
    }

    const firstBad = steps.find((s) => s.kind === 'block') ?? steps.find((s) => s.kind === 'hard');

    return {
      key,
      name: def.name,
      site: def.site,
      summary: def.summary,
      footer: def.footer,
      items,
      ...chip(def.chip),
      stepCount: def.steps.length,
      ribbon: steps.map((s) => ({
        bg: RIBBON_BG[s.kind],
        h: s.kind === 'block' ? '100%' : s.kind === 'hard' ? '68%' : '40%',
        title: `${s.num}. ${s.label} — ${s.note}`,
      })),
      firstBreak: firstBad
        ? `first breaks at step ${firstBad.num} · ${firstBad.label}`
        : 'no barriers found',
      firstBreakColor: firstBad ? (firstBad.kind === 'block' ? '#96231c' : '#7a4e0a') : '#0b5f58',
      canToggle,
      toggleLabel: open ? 'Collapse clean steps' : `Show all ${def.steps.length} steps`,
    };
  });
}

/* ---------------------------------------------------------- findings --- */

export type FindingFilter = 'all' | Severity | 'dismissed';

export const FIND_FILTERS: Array<[FindingFilter, string]> = [
  ['all', 'Everything open'],
  ['must', 'Must fix'],
  ['should', 'Should fix'],
  ['nice', 'Nice to fix'],
  ['dismissed', 'Dismissed'],
];

export function findingFilterCount(records: FindingRecord[], k: FindingFilter): number {
  if (k === 'all') return records.filter(isOpen).length;
  if (k === 'dismissed') return records.filter((r) => !isOpen(r)).length;
  return records.filter((r) => r.severity === k && isOpen(r)).length;
}

export interface FindingRow extends SevSkin {
  index: number;
  what: string;
  wcag: string;
  area: string;
  pages: string;
  status: string;
  statusColor: string;
  areaColor: string;
  areaRadius: string;
}

export function findingRows(records: FindingRecord[], filter: FindingFilter): FindingRow[] {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) =>
      filter === 'all'
        ? isOpen(record)
        : filter === 'dismissed'
          ? !isOpen(record)
          : record.severity === filter && isOpen(record),
    )
    .map(({ record, index }) => ({
      index,
      what: record.what,
      wcag: record.wcag,
      area: record.area,
      pages: record.pages,
      status: record.status,
      ...SEV_SKIN[record.severity],
      statusColor: STATUS_COLOR[record.status] ?? '#3a464e',
      areaColor: record.area === 'Back end' ? '#7a4e0a' : '#37507e',
      areaRadius: record.area === 'Back end' ? '2px' : '50%',
    }));
}

export function findingSummary(records: FindingRecord[], run: number): string {
  if (!records.length) return `No findings in run #${run} — clean for this standard`;
  const open = records.filter(isOpen);
  const nMust = open.filter((r) => r.severity === 'must').length;
  const nShould = open.filter((r) => r.severity === 'should').length;
  return `${nMust} must fix · ${nShould} should fix · run #${run}`;
}

export interface FindingDetailView extends SevSkin {
  what: string;
  wcag: string;
  wcagLabel: string;
  area: string;
  areaColor: string;
  areaRadius: string;
  pages: string;
  pagesChip: string;
  status: string;
  plain: string;
  blocks: string;
  hasBlocks: boolean;
  file: string;
  bad: string;
  good: string;
  fileNote: string;
  where: Array<{ path: string; where: string }>;
  crumb: string;
  assignee: string;
  assigneeInitials: string;
}

export function findingDetail(
  clientName: string,
  records: FindingRecord[],
  index: number,
  run: number,
): FindingDetailView | null {
  const safe = Math.min(index, Math.max(0, records.length - 1));
  const record = records[safe];
  if (!record) return null;
  const { detail } = record;
  const assigned = record.status === 'Assigned';
  const owner = clientName === 'Acme Outfitters' ? 'Dana Moss' : 'the client team';
  return {
    what: record.what,
    wcag: record.wcag,
    wcagLabel: `WCAG ${record.wcag} · ${WCAG_NAMES[record.wcag] ?? ''}`,
    area: record.area,
    areaColor: record.area === 'Back end' ? '#7a4e0a' : '#37507e',
    areaRadius: record.area === 'Back end' ? '2px' : '50%',
    pages: record.pages,
    pagesChip: `Found in ${record.pages}`,
    status: record.status,
    ...SEV_SKIN[record.severity],
    plain: detail.plain,
    blocks: detail.blocks,
    hasBlocks: Boolean(detail.blocks),
    file: detail.file,
    bad: detail.bad,
    good: detail.good,
    fileNote:
      detail.where.length > 1
        ? `The change lives in ${detail.file}, which renders on every affected page — one change closes all ${detail.where.length}.`
        : `The change lives in ${detail.file}.`,
    where: detail.where.map(([path, spot]) => ({ path, where: spot })),
    crumb: `${clientName} / Run #${run} / Finding ${safe + 1 < 10 ? '0' : ''}${safe + 1}`,
    assignee: assigned ? `Assigned to ${owner}` : 'Not assigned yet',
    assigneeInitials: assigned ? (clientName === 'Acme Outfitters' ? 'DM' : 'CT') : '—',
  };
}

export function findingHistory(
  record: FindingRecord | undefined,
  run: number,
  prevRun: number,
): Array<{ dot: string; what: string; when: string }> {
  return [
    { dot: '#96231c', what: `Found again in run #${run}`, when: `Latest run · unchanged since #${prevRun}` },
    {
      dot: '#55636b',
      what: record?.status === 'Assigned' ? 'Assigned to the client web team' : 'Not assigned to anyone yet',
      when: 'Two days ago',
    },
    {
      dot: '#7a4e0a',
      what:
        record?.status === 'Retest due'
          ? 'Marked fixed, waiting on the next run to confirm'
          : 'Marked fixed once, then reopened by a later run',
      when: 'Last week · the fix shipped to staging only',
    },
    { dot: '#37507e', what: `First seen in run #${Math.max(1, run - 27)}`, when: 'Three weeks ago' },
  ];
}

/* ---------------------------------------------------------- activity --- */

export interface ActivityRowView extends ActivityRowSeed {
  avBg: string;
  avColor: string;
}

const avatarSkin = (initials: string) =>
  initials === 'SYS' ? { avBg: '#eef1f6', avColor: '#37507e' } : { avBg: '#e3efec', avColor: '#084a44' };

export function activityCounts(): { total: number; byClient: Record<string, number> } {
  const byClient: Record<string, number> = {};
  let total = 0;
  ACTIVITY_DAYS.forEach((day) =>
    day.rows.forEach((row) => {
      byClient[row.client] = (byClient[row.client] ?? 0) + 1;
      total += 1;
    }),
  );
  return { total, byClient };
}

export const ACTIVITY_FILTER_NAMES = ACTIVITY_CLIENT_NAMES;

export function activityDays(
  selected: string,
  undone: Record<string, boolean>,
): Array<{ label: string; rows: ActivityRowView[] }> {
  return ACTIVITY_DAYS.map((day) => ({
    label: day.label,
    rows: day.rows
      .filter((row) => selected === 'all' || row.client === selected)
      .map((row) => ({
        ...row,
        ...avatarSkin(row.initials),
        revertable: row.revertable && !undone[row.target],
        reverted: row.reverted || Boolean(undone[row.target]),
      })),
  })).filter((day) => day.rows.length > 0);
}

export function activityCountLabel(shown: number, selected: string): string {
  return `${shown}${shown === 1 ? ' entry' : ' entries'}${selected === 'all' ? ' · last 7 days' : ` · ${selected}`}`;
}

/* ----------------------------------------------------------- reports --- */

export interface ReportPaper {
  title: string;
  sub: string;
  issued: string;
  client: string;
  domain: string;
  standard: string;
  verdict: string;
  verdictBg: string;
  crit: string;
  sev: [number, number, number, number];
  notesPages: string;
  preview: string;
  para1: string;
  para2: string;
}

export function draftReport(client: ClientView, records: FindingRecord[]): ReportPaper {
  const ex = CLIENT_EXTRAS[client.name];
  const niceCount = records.filter((r) => r.severity === 'nice').length;
  const stdLong = ex.standard === 'Section 508' ? 'Section 508 · WCAG 2.0 Level AA' : 'WCAG 2.2 Level AA';
  return {
    title: `${client.name} — draft report`,
    sub: `Run #${ex.run} · ${ex.standard} · not issued yet`,
    issued: 'not issued',
    client: client.name,
    domain: client.domain,
    standard: stdLong,
    verdict: VERDICT_WORD[client.kind],
    verdictBg: VERDICT_TONE[client.kind],
    crit: ex.crit,
    sev: [client.must, client.should, niceCount, records.length ? 3 : 0],
    notesPages: 'the appendix',
    preview: 'draft',
    para1:
      `Meridian Access tested ${client.pages - ex.skipped} pages and ${ex.journeyCount} user journeys on ${client.domain} for run #${ex.run}, against ${stdLong}. ` +
      (client.must > 0
        ? `${client.must} findings block conformance today.`
        : 'No findings block conformance today.') +
      ` ${ex.body}`,
    para2: `This draft has not been issued. Nothing is shared with the client until you re-issue, and the wording is frozen against run #${ex.run} at that moment.`,
  };
}

export const reportPaper = (index: number): ReportPaper => REPORT_DEFS[index];

export const AUDIENCES: Array<[Audience, string, string]> = [
  ['legal', 'Compliance and legal', 'Formal ACR wording, criterion by criterion, with dates and method.'],
  ['dev', 'The client’s developers', 'Code, file paths and the fix for each finding. No conformance language.'],
  ['exec', 'The client’s executive', 'One page: verdict, exposure, trend, what it costs to close.'],
];

export function reportSections(aud: Audience) {
  return (
    [
      ['Verdict and method', true, true],
      ['Findings by severity', true, true],
      ['Criterion-by-criterion table', aud !== 'exec', false],
      ['Plain-language notes', true, false],
      ['Code and file paths', aud === 'dev', false],
      ['Screenshots of each finding', aud !== 'exec', false],
      ['Untested pages disclosure', true, true],
    ] as Array<[string, boolean, boolean]>
  ).map(([label, on, locked]) => ({
    label,
    locked,
    tick: on ? '✓' : '',
    boxBg: on ? '#0b5f58' : '#fffdf9',
    boxBorder: on ? '#0b5f58' : '#c2b9a7',
  }));
}

const SEV_META: Array<[string, string, string]> = [
  ['Must fix', 'Blocks the task entirely', '#96231c'],
  ['Should fix', 'Slow or confusing', '#7a4e0a'],
  ['Nice to fix', 'Below the bar, not blocking', '#55636b'],
  ['AI suggestions', 'Excluded until confirmed', '#37507e'],
];

export const sevSummary = (sev: [number, number, number, number]) =>
  SEV_META.map(([label, note, color], i) => ({ n: sev[i], label, note, color }));

export const criteriaFor = (crit: string) =>
  CRITERION_SETS[crit].map(([id, name, status, color]) => ({ id, name, status, color }));

export const fixesFor = (crit: string) =>
  FIX_SETS[crit].map(([what, file, scope]) => ({ what, file, scope }));

export function reportTitleFor(aud: Audience, paper: ReportPaper): string {
  if (aud === 'dev') return `Remediation plan — ${paper.domain}`;
  if (aud === 'exec') return `Accessibility status — ${paper.client}`;
  return `${paper.client} — ${paper.domain}`;
}

export const paperKickerFor = (aud: Audience): string =>
  aud === 'dev'
    ? 'REMEDIATION PLAN'
    : aud === 'exec'
      ? 'EXECUTIVE SUMMARY'
      : 'ACCESSIBILITY CONFORMANCE REPORT';

export function standardChips(paper: ReportPaper) {
  return (
    [
      ['WCAG 2.2 AA', 'AA'],
      ['AAA', 'AAA'],
      ['508', '508'],
    ] as Array<[string, string]>
  ).map(([label, k]) => {
    const on = paper.standard.indexOf('508') > -1 ? k === '508' : k === 'AA';
    return {
      label,
      bg: on ? '#0b5f58' : '#fffdf9',
      color: on ? '#fff' : '#55636b',
      border: on ? '#0b5f58' : '#c2b9a7',
      weight: on ? 650 : 600,
    };
  });
}

/* ------------------------------------------------------- client link --- */

export interface ClientLinkView {
  name: string;
  url: string;
  meta: string;
  verdict: string;
  verdictBg: string;
  intro: string;
  footer: string;
  summary: Array<{ n: number; label: string; note: string; color: string }>;
  findings: Array<SevSkin & { what: string; wcag: string; plain: string }>;
}

const SEV_ORDER: Severity[] = ['must', 'should', 'nice'];

export function clientLinkView(clientName: string, overrides: FindingOverrides): ClientLinkView {
  const site = siteViews(overrides).find((s) => s.name === clientName) ?? siteViews(overrides)[2];
  const ex = CLIENT_EXTRAS[site.name];
  const open = findingsFor(site.name, overrides).filter(isOpen);
  const nMust = open.filter((r) => r.severity === 'must').length;
  const nShould = open.filter((r) => r.severity === 'should').length;
  const slug = site.name.toLowerCase().split(' ')[0].replace(/[^a-z]/g, '');

  return {
    name: site.name,
    url: `meridian.audit/${slug}/${ex.run}`,
    meta: `Run #${ex.run} · 31 July 2026 · ${ex.standard === 'Section 508' ? 'Section 508 · WCAG 2.0 Level AA' : 'WCAG 2.2 Level AA'} · link expires 30 August 2026`,
    verdict: VERDICT_WORD[site.kind],
    verdictBg: VERDICT_TONE[site.kind],
    intro:
      (nMust > 0
        ? `${nMust} ${nMust === 1 ? 'finding blocks' : 'findings block'} conformance today. `
        : 'No findings block conformance today. ') +
      'Each finding below says what a person experiences, and what to change.',
    footer:
      (ex.skipped > 0
        ? `${ex.skipped} pages behind a sign-in were not tested and are excluded from the score rather than counted as passing. `
        : '') +
      'Automated checks detect roughly 40% of accessibility barriers; this run was reviewed by a human auditor.',
    summary: [
      { n: nMust, label: 'Stop people completely', note: 'Must fix', color: '#96231c' },
      { n: nShould, label: 'Make tasks slow', note: 'Should fix', color: '#7a4e0a' },
      {
        n: site.pages - ex.skipped,
        label: 'Pages tested',
        note: ex.skipped > 0 ? `${ex.skipped} could not be reached` : 'full coverage',
        color: '#0b5f58',
      },
    ],
    findings: open
      .slice()
      .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
      .slice(0, 3)
      .map((r) => ({ what: r.what, wcag: r.wcag, plain: r.detail.plain, ...SEV_SKIN[r.severity] })),
  };
}

export function shareLink(clientName: string, run: number) {
  const state = LINK_STATES[clientName] ?? 'none';
  const slug = clientName.toLowerCase().split(' ')[0].replace(/[^a-z]/g, '');
  return {
    state,
    live: state === 'live',
    url: `meridian.audit/${slug}/${run}`,
    note: LINK_NOTES[state],
    urlColor: state === 'live' ? '#3a464e' : '#a9a294',
    urlDecoration: state === 'live' ? 'none' : 'line-through',
    deadLabel: state === 'expired' ? 'EXPIRED' : 'NO LINK',
    viewers: (VIEWERS_BY_CLIENT[clientName] ?? []).map(([initials, name, when]) => ({
      initials,
      name,
      when,
    })),
  };
}

/* ----------------------------------------------------------- search --- */

export interface SearchResult extends Chip {
  name: string;
  domain: string;
  mustLabel: string;
  mustColor: string;
  index: number;
}

export function searchResults(query: string, overrides: FindingOverrides): SearchResult[] {
  const q = query.trim().toLowerCase();
  const all = siteViews(overrides);
  // With no query the panel is a worklist, not a blank slate: it offers the
  // clients that currently have blocking work.
  const pool = q
    ? all.filter((s) => `${s.name} ${s.domain}`.toLowerCase().includes(q))
    : all.filter((s) => s.must > 0).slice(0, 4);
  return pool.slice(0, 6).map((s) => ({
    name: s.name,
    domain: s.domain,
    index: s.index,
    chipBg: s.chipBg,
    chipColor: s.chipColor,
    chipBorder: s.chipBorder,
    chipLabel: s.chipLabel,
    mustLabel: s.must > 0 ? `${s.must} must fix` : s.kind === 'scan' ? 'running' : 'clean',
    mustColor: s.must > 0 ? '#96231c' : '#55636b',
  }));
}

export const searchHint = (query: string, results: SearchResult[]): string =>
  query.trim()
    ? `${results.length}${results.length === 1 ? ' MATCH' : ' MATCHES'}`
    : 'NEEDS WORK FIRST';

/* --------------------------------------------------------- settings --- */

export const CREDENTIAL_SKIN = (
  state: 'expired' | 'missing' | 'ok' | 'none',
  skipped: number,
  run: number,
): { border: string; bg: string; color: string; text: string; button: string } =>
  ({
    expired: {
      border: '#dfba79',
      bg: '#fdf9f1',
      color: '#7a4e0a',
      text: `Password expired — ${skipped} pages skipped in run #${run}`,
      button: 'Update credentials',
    },
    missing: {
      border: '#dfba79',
      bg: '#fdf9f1',
      color: '#7a4e0a',
      text: `Sign-in failed — ${skipped} pages skipped in run #${run}`,
      button: 'Fix credentials',
    },
    ok: {
      border: '#bcd9d2',
      bg: '#f2f8f6',
      color: '#0b5f58',
      text: `Working — all signed-in pages were reached in run #${run}`,
      button: 'Replace',
    },
    none: {
      border: '#ddd6c8',
      bg: '#f9f7f1',
      color: '#55636b',
      text: 'No test account. Signed-in pages are excluded rather than passed.',
      button: 'Add an account',
    },
  })[state];

export const configFor = (clientName: string) => CONFIG_BY_CLIENT[clientName];

export const clientExtra = (clientName: string) => CLIENT_EXTRAS[clientName];

export const reportsForClient = (clientName: string) =>
  REPORT_DEFS.map((r, index) => ({ ...r, index })).filter((r) => r.title.indexOf(clientName) === 0);
