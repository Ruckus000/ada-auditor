import type { StoredFinding, StoredRunRecord } from '../domain/persistence';
import { runVerdict } from './presentation/verdict';

/**
 * Renders a stored run as a print-ready HTML report.
 *
 * Pure and browser-free, so the escaping below is unit-testable without
 * launching Chromium — which matters, because it is the only thing standing
 * between the audited site's markup and our own output.
 *
 * ## Every value here is untrusted
 *
 * `htmlSnippet`, `selector` and `message` are captured from the site under
 * audit. A page can put `<script>` or `<img onerror=…>` in any of them, and
 * this report is rendered by a real browser and may be shared with a client.
 * So there is exactly one way text reaches the output — `escapeHtml` — and no
 * interpolation bypasses it.
 */

const SEVERITY_ORDER = ['critical', 'major', 'minor', 'needs-review', 'advisory'];

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  'needs-review': 'Needs manual review',
  advisory: 'Advisory',
};

/**
 * Keyed by the verdict a screen would show, not by `ciStatus`.
 *
 * `ciStatus` holds only `pass | fail | inconclusive`, and the gate gives
 * `pass` to any run with no *critical* finding — so a site with eighty-six
 * unresolved failures earned the same word as one with none. Every platform
 * screen already told those apart, because they go through `runVerdict`, which
 * answers `risk` for "nothing blocking, but not clean". This document did not,
 * and so said the softer of the two things the product believed — on the copy
 * a client's counsel reads rather than the one an operator glances at.
 *
 * That was a second definition of a rule `services/presentation/verdict.ts`
 * exists to hold, and its own comment calls a business rule rather than
 * presentation garnish. There is one definition again.
 */
const VERDICT_COPY: Record<string, { title: string; detail: string }> = {
  fail: {
    title: 'Does not conform',
    detail:
      'Blocking issues were found against the WCAG success criteria checked automatically.',
  },
  risk: {
    title: 'Issues found, none blocking',
    detail:
      'Automated checks found failures against the WCAG success criteria checked here. None is classed as blocking, and every one is listed below. Automated testing cannot establish full conformance on its own.',
  },
  pass: {
    title: 'No blocking issues found',
    detail:
      'Automated checks found no blocking issues. Automated testing cannot establish full conformance on its own.',
  },
  inconclusive: {
    title: 'Inconclusive',
    // "incomplete" until a page could also be unjudgeable for having been
    // served as an error, at which point the word named the wrong problem in a
    // document a client's counsel may read: nothing was incomplete, the site
    // returned 500. Both reasons are stated rather than the narrower one.
    detail:
      'Evidence for this run was not usable — an artifact was missing, or a page was served as an error — so no conformance judgement is made. Deterministic findings are withheld rather than reported from partial evidence.',
  },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A help URL is rendered as a link, so its scheme is checked — `javascript:`
 * in an `href` executes on click even when the text around it is escaped.
 */
function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

/**
 * axe's failure summaries are multi-line: an intro ("Fix any of the
 * following:") followed by indented alternatives. HTML collapses newlines, so
 * rendering the raw string produces one unreadable run-on sentence — which is
 * exactly the part of the report a developer is supposed to act on. Split it
 * back into the list it already is.
 */
/**
 * The fix list, when the run stored one.
 *
 * Preferred over splitting `failureSummary` on newlines below: that heuristic
 * depends on axe's prose staying in the shape it was in, and it loses the
 * difference between "any one of these" and "all of these" — the only part a
 * developer has to get right.
 */
function renderRemediation(finding: StoredFinding): string {
  const group = (label: string, items: string[] | undefined) =>
    items && items.length > 0
      ? `<p class="label">${label}</p><ul class="remedies">${items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`
      : '';

  return (
    group('Fix any one of these', finding.remediationAnyOf) +
    group('Fix all of these', finding.remediationAllOf)
  );
}

function renderMessage(message: string): string {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return `<p class="message">${escapeHtml(message)}</p>`;
  }

  const [intro, ...rest] = lines;

  return `<p class="message">${escapeHtml(intro)}</p>
      <ul class="remedies">${rest
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('')}</ul>`;
}

function renderFinding(finding: StoredFinding): string {
  const criteria = finding.wcagCriteria?.length
    ? `WCAG ${finding.wcagCriteria.map(escapeHtml).join(', ')}${
        finding.conformanceLevel ? ` (Level ${escapeHtml(finding.conformanceLevel)})` : ''
      }`
    : 'Best practice';

  const href = safeHref(finding.helpUrl);

  return `
    <article class="finding sev-${escapeHtml(finding.severity)}">
      <header>
        <span class="badge">${escapeHtml(
          SEVERITY_LABEL[finding.severity] ?? finding.severity,
        )}</span>
        <h4>${escapeHtml(finding.title ?? finding.code)}</h4>
        ${finding.title ? `<p class="code">${escapeHtml(finding.code)}</p>` : ''}
        <p class="criteria">${criteria}</p>
      </header>
      ${
        (finding.remediationAnyOf?.length ?? 0) + (finding.remediationAllOf?.length ?? 0) > 0
          ? renderRemediation(finding)
          : renderMessage(finding.message ?? '')
      }
      ${
        finding.selector
          ? `<p class="label">Element</p><pre class="selector">${escapeHtml(finding.selector)}</pre>`
          : ''
      }
      ${
        finding.htmlSnippet
          ? `<p class="label">Markup</p><pre class="snippet">${escapeHtml(finding.htmlSnippet)}</pre>`
          : ''
      }
      ${href ? `<p class="help"><a href="${escapeHtml(href)}">How to fix this</a></p>` : ''}
    </article>`;
}

/**
 * Groups findings by the page they were found on, preserving visit order.
 *
 * A run audits every page its journey walks through, so a flat list forces the
 * reader to work out which of five screens each finding belongs to. Advisory
 * findings carry no page — they are produced once over the whole journey — and
 * collect in a trailing group of their own rather than being attributed to a
 * page they were not derived from.
 */
type PageGroup = { pageUrl: string | null; title?: string; findings: StoredFinding[] };

function groupByPage(run: StoredRunRecord): PageGroup[] {
  const byUrl = new Map<string, StoredFinding[]>();
  const unattributed: StoredFinding[] = [];

  for (const finding of run.findings) {
    if (!finding.pageUrl) {
      unattributed.push(finding);
      continue;
    }
    const bucket = byUrl.get(finding.pageUrl);
    if (bucket) bucket.push(finding);
    else byUrl.set(finding.pageUrl, [finding]);
  }

  // Visit order when the run records its pages; otherwise the order findings
  // first appeared, which for a single-page run is the flat list as before.
  const orderedUrls = [
    ...(run.pages ?? []).map((page) => page.url).filter((url) => byUrl.has(url)),
    ...[...byUrl.keys()].filter((url) => !(run.pages ?? []).some((page) => page.url === url)),
  ];

  const titleFor = (url: string) => run.pages?.find((page) => page.url === url)?.title;

  const groups: PageGroup[] = orderedUrls.map((url) => ({
    pageUrl: url,
    title: titleFor(url),
    findings: sortBySeverity(byUrl.get(url) ?? []),
  }));

  if (unattributed.length > 0) {
    groups.push({ pageUrl: null, title: undefined, findings: sortBySeverity(unattributed) });
  }

  return groups;
}

function sortBySeverity(findings: StoredFinding[]): StoredFinding[] {
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function renderPageGroup(group: PageGroup): string {
  const heading =
    group.pageUrl === null
      ? 'Across the journey'
      : `${group.title ? `${escapeHtml(group.title)} — ` : ''}<span class="page-url">${escapeHtml(
          group.pageUrl,
        )}</span>`;

  return `
    <section class="page-group">
      <h3 class="page-heading">${heading}</h3>
      <p class="page-count">${group.findings.length} ${
        group.findings.length === 1 ? 'finding' : 'findings'
      }</p>
      ${group.findings.map(renderFinding).join('\n')}
    </section>`;
}

export function renderRunReport(run: StoredRunRecord): string {
  const verdictKind = runVerdict({
    status: run.status,
    ciStatus: run.ciStatus,
    findings: run.findings,
  });
  const verdict = VERDICT_COPY[verdictKind] ?? {
    title: escapeHtml(verdictKind),
    detail: '',
  };

  const findings = sortBySeverity(run.findings);
  const groups = groupByPage(run);

  const blocking = findings.filter(
    (f) => f.source === 'deterministic' && f.severity === 'critical',
  ).length;

  const counts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  })).filter((entry) => entry.count > 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Accessibility report — ${escapeHtml(run.journeyId)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font: 11pt/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #16181d; margin: 0;
  }
  h1 { font-size: 20pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  h2 { font-size: 13pt; margin: 22pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #d8dce3; }
  h4 { font-size: 11.5pt; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .page-group { margin: 0 0 20pt; }
  .page-heading { font-size: 11.5pt; margin: 16pt 0 2pt; }
  .page-url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5pt; color: #5b6272; word-break: break-all; }
  .page-count { font-size: 9pt; color: #5b6272; margin: 0 0 8pt; }
  .meta { color: #5b6272; font-size: 9.5pt; margin: 0 0 18pt; }
  .verdict { padding: 12pt 14pt; border-radius: 6px; border: 1px solid #d8dce3; background: #f7f8fa; }
  .verdict.fail { border-color: #e0b4b4; background: #fdf5f5; }
  .verdict.pass { border-color: #b8d9c0; background: #f4faf5; }
  .verdict.risk { border-color: #e6c08a; background: #fdf6ec; }
  .verdict.inconclusive { border-color: #ddd0a8; background: #fdfaf2; }
  .verdict h2 { margin: 0 0 4pt; border: 0; padding: 0; font-size: 14pt; }
  .verdict p { margin: 0; color: #454b57; }
  .counts { display: flex; flex-wrap: wrap; gap: 8pt; margin: 14pt 0 0; padding: 0; list-style: none; }
  .counts li { font-size: 9.5pt; padding: 3pt 8pt; border-radius: 999px; background: #eef0f4; }
  .finding {
    border: 1px solid #e2e5ea; border-left: 3px solid #98a0b0; border-radius: 5px;
    padding: 10pt 12pt; margin: 0 0 10pt; break-inside: avoid;
  }
  .finding.sev-critical { border-left-color: #b4443c; }
  .finding.sev-major { border-left-color: #c2762a; }
  .finding.sev-minor { border-left-color: #7a8496; }
  .finding.sev-needs-review { border-left-color: #4a72b0; }
  .finding.sev-advisory { border-left-color: #6b5fa8; }
  .badge { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #5b6272; }
  .criteria { font-size: 9.5pt; color: #5b6272; margin: 2pt 0 0; }
  .message { margin: 8pt 0 0; }
  .remedies { margin: 5pt 0 0; padding-left: 16pt; color: #454b57; font-size: 10pt; }
  .remedies li { margin: 0 0 2pt; }
  .label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #5b6272; margin: 10pt 0 3pt; }
  pre {
    font: 9pt/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f4f5f8; border: 1px solid #e2e5ea; border-radius: 4px;
    padding: 6pt 8pt; margin: 0; white-space: pre-wrap; word-break: break-word;
  }
  .code { margin: 1pt 0 0; font-family: ui-monospace, monospace; font-size: 8.5pt; color: #55606a; }
  .help { margin: 9pt 0 0; font-size: 9.5pt; }
  a { color: #2a5db0; }
  footer { margin-top: 24pt; padding-top: 8pt; border-top: 1px solid #d8dce3; color: #5b6272; font-size: 8.5pt; }
</style>
</head>
<body>
  <h1>Accessibility report</h1>
  <p class="meta">
    Journey <strong>${escapeHtml(run.journeyId)}</strong> ·
    ${escapeHtml(run.environment)} ·
    ${escapeHtml(run.createdAt)} ·
    run ${escapeHtml(run.requestId)}
  </p>

  <section class="verdict ${escapeHtml(verdictKind)}">
    <h2>${verdict.title}</h2>
    <p>${verdict.detail}</p>
    <ul class="counts">
      ${
        run.pages
          ? `<li><strong>${run.pages.length}</strong> ${
              run.pages.length === 1 ? 'page' : 'pages'
            } audited</li>`
          : ''
      }
      <li><strong>${blocking}</strong> blocking</li>
      ${counts
        .map(
          (entry) =>
            `<li><strong>${entry.count}</strong> ${escapeHtml(
              SEVERITY_LABEL[entry.severity] ?? entry.severity,
            ).toLowerCase()}</li>`,
        )
        .join('\n      ')}
    </ul>
  </section>

  <h2>Findings</h2>
  ${
    groups.length > 0
      ? groups.map(renderPageGroup).join('\n')
      : '<p>No findings were recorded for this run.</p>'
  }

  <footer>
    Generated from run ${escapeHtml(run.requestId)}. Automated testing detects a
    subset of accessibility barriers; it does not by itself establish conformance,
    and findings marked for manual review need a human decision.
  </footer>
</body>
</html>`;
}
