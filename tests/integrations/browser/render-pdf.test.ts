import { describe, expect, it } from 'vitest';
import { renderPdf } from '../../../src/integrations/browser/render-pdf';
import { renderRunReport } from '../../../src/services/report-html';
import type { StoredRunRecord } from '../../../src/domain/persistence';

const RUN: StoredRunRecord = {
  requestId: 'req-pdf-1',
  journeyId: 'demo-login',
  environment: 'staging',
  platform: 'generic',
  evidenceStatus: 'complete',
  ciStatus: 'fail',
  durationMs: 4321,
  createdAt: '2026-08-07T00:00:00.000Z',
  findings: [
    {
      code: 'image-alt',
      severity: 'critical',
      source: 'deterministic',
      message: 'Images must have alternate text',
      wcagCriteria: ['1.1.1'],
      conformanceLevel: 'A',
      selector: '#hero',
      htmlSnippet: '<img src="hero.png">',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    },
  ],
};

describe('renderPdf', () => {
  it('produces a real PDF', async () => {
    const pdf = await renderPdf(renderRunReport(RUN));

    // %PDF- magic bytes, then a non-trivial body.
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  }, 120_000);

  it('renders a report whose findings contain hostile markup', async () => {
    // The end-to-end complement to the escaping unit tests: proves a snippet
    // that would be dangerous as markup passes through the renderer safely.
    const pdf = await renderPdf(
      renderRunReport({
        ...RUN,
        findings: [
          {
            ...RUN.findings[0],
            htmlSnippet: '<script>document.title="pwned"</script>',
            selector: '</pre><script>alert(1)</script>',
          },
        ],
      }),
    );

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 120_000);
});
