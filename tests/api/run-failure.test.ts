import { describe, expect, it } from 'vitest';
import { classifyRunFailure } from '../../src/app/api/_lib/run-failure';

describe('classifyRunFailure', () => {
  it('classifies contract scope rejections', () => {
    expect(classifyRunFailure('Journey is not allowed by run contract scope.')).toBe(
      'journey_not_in_scope',
    );
  });

  it('classifies both shapes of policy rejection', () => {
    // run-audit throws a fixed sentence; the journey runner interpolates the
    // action and environment, which is exactly the detail we must not echo.
    expect(classifyRunFailure('Action is not allowed by environment policy.')).toBe(
      'action_not_allowed',
    );
    expect(classifyRunFailure('Action "mutate-test-data" is not allowed in production.')).toBe(
      'action_not_allowed',
    );
  });

  it('classifies artifact path rejections', () => {
    expect(classifyRunFailure('stepId must not escape the artifacts directory.')).toBe(
      'invalid_step_id',
    );
    expect(classifyRunFailure('stepId must name a file within the artifacts directory.')).toBe(
      'invalid_step_id',
    );
  });

  it('classifies the failureMode=stop path', () => {
    expect(
      classifyRunFailure('Run stopped due to incomplete evidence under failureMode=stop.'),
    ).toBe('incomplete_evidence');
  });

  it('classifies a run that named a target and no steps', () => {
    // The exact sentence `runBrowserAudit` throws. Without this branch the one
    // failure the runner categorises precisely was reported as "a reason it
    // could not categorise" — to the bearer callers of /api/audit/run, which
    // are the only ones that reach the runner guard without passing the
    // platform route's 422 first.
    expect(classifyRunFailure('A run against a target URL must name its own steps.')).toBe(
      'journey_has_no_steps',
    );
  });

  it('classifies a step that could not be performed', () => {
    // The shape `attemptStep` builds. A stale selector is the likeliest way a
    // real journey dies and it is the operator's to fix, so it must not arrive
    // as the same code as a browser crash.
    expect(
      classifyRunFailure(
        'Step 3 ("sign in") could not fill "#username": the selector never matched anything on the page.',
      ),
    ).toBe('journey_step_failed');
  });

  it('collapses anything unrecognised, so new internals are opaque by default', () => {
    // The point of the default: a future error carrying a path or a stack must
    // not reach the client just because nobody remembered to map it.
    for (const message of [
      'ENOENT: no such file or directory, open /Users/someone/secret/config.json',
      'connect ECONNREFUSED 127.0.0.1:9222',
      // Near the new branch without matching it: no index, no quoted action.
      'Step over the broken tile could not be avoided',
      'browserType.launch: Executable does not exist at /root/.cache/ms-playwright/chromium/headless_shell',
      '',
    ]) {
      expect(classifyRunFailure(message)).toBe('audit_run_failed');
    }
  });
});
