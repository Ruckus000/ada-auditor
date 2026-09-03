import { describe, expect, it } from 'vitest';
import { inspectOutcome } from '../../src/app/platform/components/client/document-shared';

/**
 * What "Inspect all unreviewed" does with each answer.
 *
 * The loop is sequential and can be two hundred documents long. A budget
 * refusal is the one answer that will be the same for every document after
 * it, so the loop has to stop there rather than paint two hundred red rows —
 * and it has to keep going past every other refusal, because a signed PDF in
 * position three says nothing about position four.
 */
function refused(status: number, error: string, message?: string): Response {
  return Response.json({ error, ...(message ? { message } : {}), requestId: 'r' }, { status });
}

describe('inspectOutcome', () => {
  it('halts the batch on a budget refusal, with the route\'s sentence', async () => {
    const result = await inspectOutcome(
      refused(429, 'document_budget_exceeded', 'Document work is capped at 500 per hour and this hour is spent. It resets in 9 minutes.'),
    );

    expect(result.halts).toBe(true);
    expect(result.outcome).toMatchObject({ state: 'failed', message: expect.stringContaining('9 minutes') });
  });

  it('carries on past any other refusal', async () => {
    const result = await inspectOutcome(refused(503, 'document_toolchain_unavailable'));

    expect(result.halts).toBe(false);
    expect(result.outcome.state).toBe('failed');
  });

  it('reads the summary out of a successful answer', async () => {
    const result = await inspectOutcome(
      Response.json({ inspection: { summary: { tagged: true, pages: 2, gaps: [] } } }),
    );

    expect(result.halts).toBe(false);
    expect(result.outcome).toMatchObject({ state: 'done', converted: false });
  });

  it('names a success that carried no reading', async () => {
    const result = await inspectOutcome(Response.json({ document: {} }));

    expect(result.outcome).toMatchObject({ state: 'failed', message: expect.stringContaining('without a reading') });
  });
});
