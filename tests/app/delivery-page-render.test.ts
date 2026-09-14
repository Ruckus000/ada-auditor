import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The page a client opens from a delivery link.
 *
 * It says "PDF/UA-1 verification passed" for every document, which is true —
 * eligibility requires it — and until the review it said nothing else, even
 * for a document whose fidelity check had found a count the delivered file
 * and its source disagree on. The decision was to disclose, not to block, so
 * this is where the disclosure has to be visible.
 */

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import('../../src/integrations/persistence');
const { default: DeliveryPage } = await import('../../src/app/d/[token]/page');

const TOKEN = 'a'.repeat(64);
const detail = '4 list items in the delivered document for 5 declared in the source — 1 did not survive conversion';

async function render(knownDifferences?: Array<{ criterion: string; detail: string }>) {
  const platform = new MemoryPlatformStore();
  setPlatformStore(platform);
  await platform.upsertClient({ id: 'client-a', name: 'Town' });
  const revision = await platform.documentRevision('client-a');
  await platform.saveDeliveryBundle({
    id: 'bundle-a', clientId: 'client-a', clientName: 'Town', revision, artifactUrl: 'private', sha256: 'b'.repeat(64), bytes: 2048,
    preparedAt: '2026-09-13T00:00:00.000Z', preparedBy: 'Alex', omissions: [],
    entries: [{ documentId: 'd1', conversionId: 'c1', signoffId: 's1', source: 'https://town.example/agenda.pdf', inputSha256: 'c'.repeat(64),
      outputSha256: 'd'.repeat(64), verificationSha256: 'e'.repeat(64), signedBy: 'Alex', signedAt: '2026-09-13T00:00:00.000Z',
      ...(knownDifferences ? { knownDifferences } : {}) }],
  }, revision);
  await platform.issueDeliveryBundle('bundle-a', revision, TOKEN, 'Alex', '2026-09-13T01:00:00.000Z');
  return renderToStaticMarkup(await DeliveryPage({ params: Promise.resolve({ token: TOKEN }) }));
}

afterEach(() => resetPlatformStore());

describe('the delivery page', () => {
  it('names a known difference from the source beside the verification it passed', async () => {
    const html = await render([{ criterion: '1.3.1', detail }]);
    expect(html).toContain('PDF/UA-1 verification passed');
    expect(html).toContain('Known differences from the source document');
    expect(html).toContain('1.3.1');
    expect(html).toContain('did not survive conversion');
  });

  it('adds nothing where there is nothing to disclose', async () => {
    const html = await render();
    expect(html).not.toContain('Known differences');
  });
});
