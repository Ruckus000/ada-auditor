import { describe, expect, it } from 'vitest';
import { setupStage } from '../../src/services/setup-state';
import type { ClientDetail, JourneySummary, RunSummary } from '../../src/services/client-detail';

const journey = (over: Partial<JourneySummary> = {}): JourneySummary => ({
  id: 'j1', name: 'Homepage', targetUrl: 'https://example.com/', steps: [],
  runRefusal: null, schedule: 'off', environment: 'production', credentials: [],
  lastRun: null, ...over,
});
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  requestId: 'r1', createdAt: '2026-08-19T00:00:00.000Z', verdict: 'pass', score: 90,
  mustFix: 0, shouldFix: 0, needsReview: 0, pagesAudited: 1, evidenceStatus: 'complete',
  durationMs: 1000, slowestPageMs: 500, ...over,
});
const detail = (over: Partial<ClientDetail>): ClientDetail => ({
  id: 'c1', name: 'Acme', createdAt: '2026-08-19T00:00:00.000Z',
  journeys: [], lastRun: null, hasCompletedRun: false, ...over,
});

describe('setupStage', () => {
  it('a client with no journeys needs a site', () => {
    expect(setupStage(detail({}))).toEqual({ stage: 'site' });
  });
  it('an unrunnable journey needs steps', () => {
    const j = journey({ runRefusal: 'journey_has_no_steps' });
    expect(setupStage(detail({ journeys: [j] }))).toEqual({ stage: 'steps', journey: j });
  });
  it('a runnable journey with no run needs its first audit', () => {
    const j = journey();
    expect(setupStage(detail({ journeys: [j] }))).toEqual({ stage: 'first-run', journey: j });
  });
  it('a run in flight is watched, not restarted', () => {
    const j = journey({ lastRun: run({ verdict: 'scan' }) });
    expect(setupStage(detail({ journeys: [j] }))).toEqual({
      stage: 'running', journey: j, requestId: 'r1',
    });
  });
  it('a failed first run gets the failure stage, with the reason', () => {
    const j = journey({ lastRun: run({ verdict: 'inconclusive', failureReason: 'target_unreachable' }) });
    expect(setupStage(detail({ journeys: [j] }))).toEqual({
      stage: 'failed', journey: j, requestId: 'r1', failureReason: 'target_unreachable',
    });
  });
  it('any completed run means done, whatever the newest run did', () => {
    const j = journey({ lastRun: run({ verdict: 'inconclusive', failureReason: 'target_unreachable' }) });
    expect(setupStage(detail({ journeys: [j], hasCompletedRun: true }))).toEqual({ stage: 'done' });
  });
  it('prefers a runnable journey over an unrunnable one', () => {
    const dead = journey({ id: 'dead', runRefusal: 'journey_not_runnable' });
    const live = journey({ id: 'live' });
    expect(setupStage(detail({ journeys: [dead, live] }))).toEqual({ stage: 'first-run', journey: live });
  });
});
