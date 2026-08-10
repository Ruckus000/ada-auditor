import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDACTED, logError, logEvent, logInfo, logWarn } from '../../src/services/logger';

/** Parses the single line the logger wrote to the given spy. */
function emitted(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledOnce();
  return JSON.parse(spy.mock.calls[0]![0] as string) as Record<string, unknown>;
}

describe('logEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes type, level and a timestamp alongside the caller fields', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    logInfo('audit_run_log', { requestId: 'req-1', durationMs: 42 });

    const line = emitted(log);
    expect(line.type).toBe('audit_run_log');
    expect(line.level).toBe('info');
    expect(line.requestId).toBe('req-1');
    expect(line.durationMs).toBe(42);
    expect(typeof line.ts).toBe('string');
    expect(new Date(line.ts as string).toISOString()).toBe(line.ts);
  });

  // `type` leads the line so a human scanning raw output can see what an event
  // is without reading to the end of it.
  it('writes type as the first key', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    logInfo('migrate', { statements: 3 });

    expect((log.mock.calls[0]![0] as string).startsWith('{"type":"migrate"')).toBe(true);
  });

  // The whole reason this module exists is that five call sites had drifted.
  // A caller that could relabel an event would reintroduce that by the back
  // door — a log query for `audit_run_log` would silently miss runs.
  it('does not let a caller field overwrite the envelope', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    logInfo('audit_run_log', { type: 'something_else', level: 'error', ts: 'yesterday' });

    const line = emitted(log);
    expect(line.type).toBe('audit_run_log');
    expect(line.level).toBe('info');
    expect(line.ts).not.toBe('yesterday');
  });

  it('routes warn and error to their own console methods', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    logWarn('audit_page_cap_reached', { pagesSkipped: 2 });
    logError('run_failed', { requestId: 'req-2' });

    expect(emitted(warn).type).toBe('audit_page_cap_reached');
    expect(emitted(error).type).toBe('run_failed');
    expect(log).not.toHaveBeenCalled();
  });

  describe('redaction', () => {
    it('redacts secret-shaped keys at the top level', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      logInfo('console_unlock', {
        runToken: 'super-secret-value',
        authorization: 'Bearer abc',
        requestId: 'req-3',
      });

      const line = emitted(log);
      expect(line.runToken).toBe(REDACTED);
      expect(line.authorization).toBe(REDACTED);
      expect(line.requestId).toBe('req-3');
    });

    // Journey steps nest a credential reference two levels down. A top-level
    // -only scrub would ship it.
    it('redacts nested and array-nested secrets', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      logInfo('audit_run_log', {
        steps: [{ action: 'login', credentialRef: 'acme', selector: '#user' }],
        env: { DATABASE_URL: 'postgres://x', KV_REST_API_TOKEN: 'kv-secret' },
      });

      const line = emitted(log);
      const steps = line.steps as Array<Record<string, unknown>>;
      expect(steps[0]!.credentialRef).toBe(REDACTED);
      expect(steps[0]!.selector).toBe('#user');
      expect((line.env as Record<string, unknown>).KV_REST_API_TOKEN).toBe(REDACTED);
    });

    it('survives a cyclic object rather than throwing inside a log call', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const cyclic: Record<string, unknown> = { name: 'loop' };
      cyclic.self = cyclic;

      expect(() => logInfo('cyclic_check', { cyclic })).not.toThrow();
      expect(emitted(log).type).toBe('cyclic_check');
    });
  });

  it('accepts an explicit level', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logEvent('warn', 'store_memory_mode', { note: 'nothing is persisted' });

    expect(emitted(warn).note).toBe('nothing is persisted');
  });
});
