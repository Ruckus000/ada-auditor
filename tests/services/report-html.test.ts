import { describe, expect, it } from 'vitest';
import { escapeHtml, renderRunReport } from '../../src/services/report-html';
import type { StoredFinding, StoredRunRecord } from '../../src/domain/persistence';

function finding(overrides: Partial<StoredFinding> = {}): StoredFinding {
  return {
    code: 'image-alt',
    severity: 'critical',
    source: 'deterministic',
    message: 'Images must have alternate text',
    wcagCriteria: ['1.1.1'],
    conformanceLevel: 'A',
    selector: '#hero',
    htmlSnippet: '<img src="hero.png">',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    ...overrides,
  };
}

function run(overrides: Partial<StoredRunRecord> = {}): StoredRunRecord {
  return {
    requestId: 'req-1',
    journeyId: 'demo-login',
    environment: 'staging',
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'fail',
    findings: [finding()],
    durationMs: 1234,
    createdAt: '2026-08-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('neutralises every character that can break out of text', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('escapes ampersands first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });
});

describe('renderRunReport — untrusted content', () => {
  it('escapes a script tag in the captured markup', () => {
    // The snippet is markup copied from the audited site. Rendering it raw
    // would execute a client's page inside our own report.
    const html = renderRunReport(
      run({ findings: [finding({ htmlSnippet: '<script>alert(1)</script>' })] }),
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes an event handler in the captured markup', () => {
    const html = renderRunReport(
      run({ findings: [finding({ htmlSnippet: '<img src=x onerror="fetch(`//evil`)">' })] }),
    );

    expect(html).not.toContain('onerror="fetch');
    expect(html).toContain('&lt;img src=x onerror=');
  });

  it.each([
    ['selector', { selector: '</pre><script>alert(1)</script>' }],
    ['message', { message: '</p><script>alert(1)</script>' }],
    ['code', { code: '<script>alert(1)</script>' }],
  ])('escapes injected markup in %s', (_field, overrides) => {
    const html = renderRunReport(run({ findings: [finding(overrides)] }));

    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes run metadata, which is caller-supplied', () => {
    const html = renderRunReport(run({ journeyId: '<script>alert(1)</script>' }));

    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('drops a javascript: help URL rather than linking it', () => {
    // Escaping the text around an href does not stop the href itself.
    const html = renderRunReport(
      run({ findings: [finding({ helpUrl: 'javascript:alert(1)' })] }),
    );

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('How to fix this');
  });

  it.each(['data:text/html,<h1>x', 'file:///etc/passwd', 'not a url'])(
    'drops the unsafe help URL %j',
    (helpUrl) => {
      const html = renderRunReport(run({ findings: [finding({ helpUrl })] }));
      expect(html).not.toContain('How to fix this');
    },
  );

  it('keeps a legitimate https help link', () => {
    const html = renderRunReport(run());

    expect(html).toContain('How to fix this');
    expect(html).toContain('https://dequeuniversity.com/rules/axe/4.12/image-alt');
  });
});

describe('renderRunReport — content', () => {
  it('states the verdict in language a client can act on', () => {
    expect(renderRunReport(run({ ciStatus: 'fail' }))).toContain('Does not conform');
    expect(renderRunReport(run({ ciStatus: 'pass', findings: [] }))).toContain(
      'No blocking issues found',
    );
    expect(renderRunReport(run({ ciStatus: 'inconclusive', findings: [] }))).toContain(
      'Inconclusive',
    );
  });

  it('cites the success criterion and level', () => {
    const html = renderRunReport(run());

    expect(html).toContain('WCAG 1.1.1');
    expect(html).toContain('Level A');
  });

  it('labels a best-practice rule rather than inventing a criterion', () => {
    const html = renderRunReport(
      run({ findings: [finding({ wcagCriteria: [], conformanceLevel: null })] }),
    );

    expect(html).toContain('Best practice');
    expect(html).not.toContain('Level null');
  });

  it('orders findings by severity so the worst is read first', () => {
    const html = renderRunReport(
      run({
        findings: [
          finding({ code: 'minor-rule', severity: 'minor' }),
          finding({ code: 'critical-rule', severity: 'critical' }),
          finding({ code: 'major-rule', severity: 'major' }),
        ],
      }),
    );

    expect(html.indexOf('critical-rule')).toBeLessThan(html.indexOf('major-rule'));
    expect(html.indexOf('major-rule')).toBeLessThan(html.indexOf('minor-rule'));
  });

  it('counts only deterministic criticals as blocking', () => {
    const html = renderRunReport(
      run({
        findings: [
          finding(),
          { code: 'ai-advisory', severity: 'advisory', source: 'ai-advisory', message: 'x' },
        ],
      }),
    );

    expect(html).toContain('<strong>1</strong> blocking');
  });

  it('says plainly that automated testing is not a conformance claim', () => {
    const html = renderRunReport(run());

    expect(html).toContain('does not by itself establish conformance');
  });

  it('renders axe multi-line remediation as a list, not a run-on sentence', () => {
    // HTML collapses newlines, so the raw summary reads as one unbroken
    // paragraph — and this is the part a developer is meant to act on.
    const html = renderRunReport(
      run({
        findings: [
          finding({
            message:
              'Fix any of the following:\n  Element has no title attribute\n  aria-label is empty',
          }),
        ],
      }),
    );

    expect(html).toContain('<p class="message">Fix any of the following:</p>');
    expect(html).toContain('<li>Element has no title attribute</li>');
    expect(html).toContain('<li>aria-label is empty</li>');
  });

  it('leaves a single-line message as a plain paragraph', () => {
    const html = renderRunReport(
      run({ findings: [finding({ message: 'Images must have alternate text' })] }),
    );

    expect(html).toContain('<p class="message">Images must have alternate text</p>');
    expect(html).not.toContain('<ul class="remedies">');
  });

  it('escapes each line of a multi-line message', () => {
    const html = renderRunReport(
      run({ findings: [finding({ message: 'Fix:\n  <script>alert(1)</script>' })] }),
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>');
  });

  it('handles a run with no findings', () => {
    const html = renderRunReport(run({ ciStatus: 'pass', findings: [] }));

    expect(html).toContain('No findings were recorded');
  });

  it('renders a finding that is missing optional fields', () => {
    const html = renderRunReport(
      run({
        findings: [
          { code: 'some-rule', severity: 'minor', source: 'deterministic' },
        ],
      }),
    );

    expect(html).toContain('some-rule');
    expect(html).toContain('Best practice');
  });
});
