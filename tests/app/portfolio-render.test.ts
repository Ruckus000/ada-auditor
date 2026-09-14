import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PortfolioRow } from '../../src/services/portfolio';

/**
 * The counts on a client's row read as English at one.
 *
 * "1 journeys · 1 documents delivered" is small, and it is the kind of small
 * discrepancy that tells a reader nobody looked at the screen with one of
 * something on it — which is most new clients.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
const { PortfolioScreen } = await import('../../src/app/platform/components/portfolio');

function row(overrides: Partial<PortfolioRow>): PortfolioRow {
  return {
    contractType: 'audit-and-remediate',
    id: 'acme',
    name: 'Acme',
    journeyCount: 1,
    deliveredDocumentCount: 1,
    lastRun: null,
    setupIncomplete: false,
    ...overrides,
  };
}

const render = (client: PortfolioRow) => renderToStaticMarkup(createElement(PortfolioScreen, { clients: [client] }));

describe('portfolio row counts', () => {
  it('says one journey and one document delivered in the singular', () => {
    const html = render(row({}));
    expect(html).toContain('1 journey ·');
    expect(html).toContain('1 document delivered');
    expect(html).not.toMatch(/1 journeys|1 documents/);
  });

  it('keeps the plural for none and for many', () => {
    expect(render(row({ journeyCount: 0, deliveredDocumentCount: 0 }))).toMatch(/0 journeys[\s\S]*0 documents delivered/);
    expect(render(row({ journeyCount: 3, deliveredDocumentCount: 12 }))).toMatch(/3 journeys[\s\S]*12 documents delivered/);
  });
});
