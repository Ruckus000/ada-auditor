import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, vi } from 'vitest';
import type { ClientDetail } from '../../src/services/client-detail';

vi.mock('../../src/app/platform/components/client/journey-schedule', () => ({ JourneySchedule: () => null }));
vi.mock('../../src/app/platform/components/client/run-journey-button', () => ({ RunJourneyButton: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ClientJourneys } = await import('../../src/app/platform/components/client/client-journeys');
const { ReportsScreen } = await import('../../src/app/platform/components/reports-screen');
const { toStepViews } = await import('../../src/domain/journey-step');

import { appendFileSync } from 'node:fs';

const OUT =
  '/private/tmp/claude-501/-Users-jphilistin-Documents-Coding-ADA-Auditor/83ae6185-b0fb-4b38-a9f6-29c1c87a2c1e/scratchpad/render-out.txt';

function text(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function log(...parts: unknown[]) {
  appendFileSync(OUT, parts.map(String).join(' ') + '\n');
}

describe('review render', () => {
  it('journey row with an inconclusive last run', () => {
    const detail = {
      id: 'acme',
      name: 'Acme',
      journeys: [
        {
          id: 'login',
          name: 'Login',
          targetUrl: 'https://acme.test',
          steps: toStepViews([{ action: 'navigate', type: 'goto', path: '/' }]),
          runRefusal: null,
          schedule: 'off',
          environment: 'production',
          credentials: [],
          lastRun: {
            requestId: 'r1',
            createdAt: '2026-09-01T10:00:00Z',
            verdict: 'inconclusive',
            score: null,
            confirmed: null,
            recommendations: null,
            needsReview: 1,
            pagesAudited: 1,
            evidenceStatus: 'degraded',
            durationMs: null,
          },
        },
      ],
    } as unknown as ClientDetail;
    const html = renderToStaticMarkup(createElement(ClientJourneys, { detail }));
    log('JOURNEY ROW TEXT >>>', text(html).match(/INCONCLUSIVE.*?\d{4}-\d{2}-\d{2}/)?.[0]);
  });
  it('reports line with an inconclusive run', () => {
    const html = renderToStaticMarkup(
      createElement(ReportsScreen, {
        reports: [
          {
            token: 't',
            requestId: 'r1',
            clientId: 'acme',
            clientName: 'Acme',
            journeyId: 'login',
            journeyName: 'Login',
            issuedAt: '2026-09-01T10:00:00Z',
            expiresAt: null,
            revokedAt: null,
            run: { confirmed: null, recommendations: null, needsReview: 1, score: null, verdict: 'inconclusive' },
            documents: null,
          },
        ] as never,
      }),
    );
    log('REPORTS LINE TEXT >>>', text(html).match(/run r1.*?(stored|passed|scored)/)?.[0]);
  });
});
