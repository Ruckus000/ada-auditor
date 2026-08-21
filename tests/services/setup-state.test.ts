import { describe, expect, it } from 'vitest';
import { setupStage } from '../../src/services/setup-state';
import type { ClientDetail, JourneySummary, RunSummary } from '../../src/services/client-detail';

const journey = (over: Partial<JourneySummary> = {}): JourneySummary => ({
  id: 'j1', name: 'Homepage', targetUrl: 'https://example.com/', steps: [],
  runRefusal: null, schedule: 'off', environment: 'production', credentials: [],
  createdAt: '2026-08-19T00:00:00.000Z', lastRun: null, ...over,
});
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  requestId: 'r1', createdAt: '2026-08-19T00:00:00.000Z', verdict: 'pass', score: 90,
  mustFix: 0, shouldFix: 0, pagesAudited: 1, evidenceStatus: 'complete',
  durationMs: 1000, slowestPageMs: 500, ...over,
});
const detail = (over: Partial<ClientDetail>): ClientDetail => ({
  id: 'c1', name: 'Acme', createdAt: '2026-08-19T00:00:00.000Z',
  journeys: [], lastRun: null, completedRun: null, ...over,
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
    const completed = run({ requestId: 'done-1' });
    const j = journey({ lastRun: run({ verdict: 'inconclusive', failureReason: 'target_unreachable' }) });
    expect(
      setupStage(detail({ journeys: [j], completedRun: { journeyId: 'j1', run: completed } })),
    ).toEqual({ stage: 'done', journey: j, run: completed });
  });
  it('carries the completed run, not the newest one', () => {
    // The results screen renders whatever this hands it. Reading `lastRun`
    // there showed a later failed rerun — score "—", zero pages — under the
    // heading "First audit complete".
    const completed = run({ requestId: 'the-audit', score: 84 });
    const j = journey({ lastRun: run({ requestId: 'later-failure', verdict: 'inconclusive' }) });
    const stage = setupStage(detail({ journeys: [j], completedRun: { journeyId: 'j1', run: completed } }));
    expect(stage).toMatchObject({ stage: 'done', run: { requestId: 'the-audit', score: 84 } });
  });
  it('a completed run on a since-archived journey still means done', () => {
    // Archiving does not unmake the run, so the client stays onboarded — but
    // there is no live journey left to offer a schedule for.
    const completed = run();
    expect(
      setupStage(detail({ journeys: [], completedRun: { journeyId: 'gone', run: completed } })),
    ).toEqual({ stage: 'done', journey: null, run: completed });
  });
  it('prefers a runnable journey over an unrunnable one', () => {
    const dead = journey({ id: 'dead', runRefusal: 'journey_not_runnable' });
    const live = journey({ id: 'live' });
    expect(setupStage(detail({ journeys: [dead, live] }))).toEqual({ stage: 'first-run', journey: live });
  });
  it('walks the oldest runnable journey, not the first one by name', () => {
    // Both stores list `order by name asc`, so a later-added journey — from
    // the discovery panel, the API, a teammate — or a plain rename could
    // otherwise move the wizard's subject underneath the operator.
    const first = journey({ id: 'first', name: 'Homepage', createdAt: '2026-08-01T00:00:00.000Z' });
    const later = journey({ id: 'later', name: 'Admin login', createdAt: '2026-08-09T00:00:00.000Z' });
    expect(setupStage(detail({ journeys: [later, first] }))).toEqual({
      stage: 'first-run', journey: first,
    });
  });
  it('falls back to the oldest unrunnable journey when none is runnable', () => {
    const older = journey({ id: 'older', runRefusal: 'journey_has_no_steps', createdAt: '2026-08-01T00:00:00.000Z' });
    const newer = journey({ id: 'newer', runRefusal: 'journey_has_no_steps', createdAt: '2026-08-09T00:00:00.000Z' });
    expect(setupStage(detail({ journeys: [newer, older] }))).toEqual({ stage: 'steps', journey: older });
  });
});
