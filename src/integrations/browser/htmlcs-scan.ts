import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from 'playwright-core';
import type { AxeScanResult } from '../../services/deterministic-audit';
import type { HtmlcsLevel, HtmlcsMessage, HtmlcsScanResult } from '../../services/htmlcs-audit';
import { DEFAULT_HTMLCS_TIMEOUT_MS } from '../../domain/run-limits';
import { logWarn } from '../../services/logger';
import { normaliseCriterion } from '../../services/wcag-reference';

/**
 * Runs HTML_CodeSniffer against a live page and narrows the result to plain
 * data — the second opinion beside `axe-scan.ts`, over the same seam rule:
 * `services/htmlcs-audit.ts` maps this shape and must import neither
 * Playwright nor HTMLCS.
 *
 * The engine is `@pa11y/html_codesniffer`'s built bundle, read by file path
 * (it exports no source string) and evaluated in the page — which is why the
 * package must stay in `serverExternalPackages` *and* be traced into the
 * function bundle (`outputFileTracingIncludes`); see the notes in
 * `next.config.mjs`. Injection relies on the context's `bypassCSP: true`
 * (`journey-runner.ts`), same as axe.
 *
 * **Main frame only.** axe walks child frames via AxeBuilder; teaching HTMLCS
 * to do the same means re-implementing that walk for a scanner that never
 * gates. A framed widget's issues still reach the run through axe.
 *
 * **Failure degrades, never fails.** HTMLCS cannot gate, so a missing second
 * opinion cannot invalidate a verdict: any error — injection blocked, the
 * page navigating mid-scan, the timeout below — logs and returns
 * `{ status: 'unavailable' }`. The timeout exists because every page's scan
 * spends the same walk budget the primary engine needs; a hung second
 * opinion starving axe would invert the priority this module exists under.
 *
 * **Trust posture** is axe's: the engine runs inside the audited page, which
 * can lie about itself. Results are evidence about the page, not secrets,
 * and every field is narrowed here before it crosses to services — element
 * text and snippets stay UNTRUSTED and are escaped at render.
 */

const require = createRequire(import.meta.url);

/** The one standard this product audits to. Deliberately not configurable. */
export const HTMLCS_STANDARD = 'WCAG2AA';

const htmlcsVersion: string = (
  require('@pa11y/html_codesniffer/package.json') as { version: string }
).version;

/** Named in `RUN_RULESET` beside the axe version — same instrument-change rule. */
export const HTMLCS_ENGINE = `htmlcs@${htmlcsVersion}:${HTMLCS_STANDARD}`;

export function resolveHtmlcsTimeoutMs(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit;
  const configured = Number(process.env.AUDITOR_HTMLCS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_HTMLCS_TIMEOUT_MS;
}

let cachedSource: string | null = null;

function htmlcsSource(): string {
  cachedSource ??= readFileSync(
    require.resolve('@pa11y/html_codesniffer/build/HTMLCS.js'),
    'utf8',
  );
  return cachedSource;
}

/** What the in-page runner hands back, before anything is trusted. */
type RawMessage = {
  type: number;
  code: unknown;
  msg: unknown;
  selector: unknown;
  html: unknown;
  axeCriteria: unknown;
};

/** One element axe reported, as a selector the page can resolve back. */
type AxeCoverageEntry = { selector: string; criteria: string[] };

/**
 * What axe already said about this page, in a form the in-page runner can
 * resolve to elements. Selector strings cannot be compared across engines —
 * axe writes `img[src="logo.png"]` where the HTMLCS runner writes
 * `body > img:nth-of-type(2)` — so overlap has to be established where both
 * resolve to the same node: in the document. Violations and incompletes
 * both count as "axe spoke": an incomplete is already in the review queue,
 * and an HTMLCS echo of it would be the same item twice.
 *
 * Only main-frame, non-iframe targets ( `target.length === 1` ) — the HTMLCS
 * scan is main-frame only, so nothing else can overlap.
 */
export function axeCoverage(axe: AxeScanResult): AxeCoverageEntry[] {
  const entries: AxeCoverageEntry[] = [];
  for (const rule of [...axe.violations, ...axe.incomplete]) {
    const criteria = rule.tags
      .map((tag) => normaliseCriterion(tag))
      .filter((criterion): criterion is string => criterion !== null);
    if (criteria.length === 0) continue;

    for (const node of rule.nodes) {
      if (node.target.length !== 1 || typeof node.target[0] !== 'string') continue;
      entries.push({ selector: node.target[0], criteria });
    }
  }
  return entries;
}

const LEVEL_BY_TYPE: Record<number, HtmlcsLevel> = { 1: 'error', 2: 'warning', 3: 'notice' };

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Unknown levels and messages with no text are dropped, not guessed at. */
function narrow(raw: RawMessage): HtmlcsMessage | null {
  const level = LEVEL_BY_TYPE[raw.type];
  const message = asString(raw.msg);
  if (!level || message === '') return null;

  return {
    level,
    code: asString(raw.code),
    message,
    selector: asString(raw.selector),
    htmlSnippet: asString(raw.html),
    axeCriteria: Array.isArray(raw.axeCriteria)
      ? raw.axeCriteria.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

/**
 * The in-page runner, as a **string literal** rather than a serialized
 * function — deliberately. A closure handed to `page.evaluate` is compiled
 * by whatever transpiler is running the process, and `tsx` (esbuild with
 * `keepNames`) rewrites named inner functions into `__name(...)` helper
 * calls that do not exist inside the audited page. Every scan then failed
 * with `ReferenceError: __name is not defined` — but only under `tsx`
 * (`smoke:real`, `blind:test`, chaos), never under vitest, which compiles
 * the same closure differently. A string is opaque to every transpiler, so
 * it runs identically no matter which toolchain launched the process.
 */
const RUNNER_SOURCE = String.raw`
window.__adaAuditorHtmlcsRun = function (args) {
  return new Promise(function (resolve, reject) {
    // The same shape axe reports elements in: id when unique, else a
    // child-indexed path. Computed in the page because the element handle
    // cannot cross the boundary.
    var cssPath = function (element) {
      if (!(element instanceof Element)) return '';
      var parts = [];
      var node = element;
      while (node && parts.length < 12) {
        var tag = node.tagName.toLowerCase();
        if (node.id !== '') {
          parts.unshift(tag + '#' + CSS.escape(node.id));
          break;
        }
        var parent = node.parentElement;
        if (parent) {
          var sameTag = [];
          for (var i = 0; i < parent.children.length; i++) {
            if (parent.children[i].tagName === node.tagName) sameTag.push(parent.children[i]);
          }
          parts.unshift(
            sameTag.length > 1 ? tag + ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')' : tag,
          );
        } else {
          parts.unshift(tag);
        }
        node = parent;
      }
      return parts.join(' > ');
    };

    // axe's selectors resolved back to nodes, so overlap is a fact about
    // elements rather than a comparison of selector dialects. A selector
    // that no longer resolves — the page moved on, or axe saw a state that
    // has since changed — simply covers nothing. Unparseable selectors
    // (shadow-piercing shapes) cover nothing either.
    var coveredByElement = new Map();
    for (var c = 0; c < args.covered.length; c++) {
      var entry = args.covered[c];
      var covered = null;
      try {
        covered = document.querySelector(entry.selector);
      } catch (unused) {}
      if (!covered) continue;
      var criteria = coveredByElement.get(covered) || new Set();
      for (var k = 0; k < entry.criteria.length; k++) criteria.add(entry.criteria[k]);
      coveredByElement.set(covered, criteria);
    }

    var timer = setTimeout(function () {
      reject(new Error('htmlcs did not finish within ' + args.timeout + 'ms'));
    }, args.timeout);

    if (!window.HTMLCS) {
      clearTimeout(timer);
      reject(new Error('HTMLCS global missing after injection'));
      return;
    }

    try {
      window.HTMLCS.process(
        args.standard,
        window.document,
        function () {
          clearTimeout(timer);
          resolve(
            window.HTMLCS.getMessages().map(function (message) {
              var isElement = message.element instanceof Element;
              return {
                type: message.type,
                code: message.code,
                msg: message.msg,
                selector: cssPath(message.element),
                html: isElement ? message.element.outerHTML.slice(0, 512) : '',
                axeCriteria: isElement
                  ? Array.from(coveredByElement.get(message.element) || [])
                  : [],
              };
            }),
          );
        },
        function () {
          clearTimeout(timer);
          reject(new Error('htmlcs failed to load its standard'));
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
};
`;

export async function scanPageWithHtmlcs(
  page: Page,
  covered: AxeCoverageEntry[] = [],
  timeoutMs = resolveHtmlcsTimeoutMs(),
): Promise<HtmlcsScanResult> {
  try {
    await page.addScriptTag({ content: `${htmlcsSource()}\n${RUNNER_SOURCE}` });

    // Evaluated as a string expression for the same transpiler-opacity
    // reason `RUNNER_SOURCE` is one. `JSON.stringify` output is a valid JS
    // literal, and Playwright awaits the returned promise.
    const raw: unknown = await page.evaluate(
      `window.__adaAuditorHtmlcsRun(${JSON.stringify({
        standard: HTMLCS_STANDARD,
        timeout: timeoutMs,
        covered,
      })})`,
    );

    const messages = (Array.isArray(raw) ? raw : [])
      .map((entry) => narrow(entry as RawMessage))
      .filter((entry): entry is HtmlcsMessage => entry !== null);

    return { status: 'ok', messages };
  } catch (error) {
    // The page's URL is not logged — a query string can carry a session token.
    logWarn('htmlcs_scan_unavailable', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { status: 'unavailable' };
  }
}
