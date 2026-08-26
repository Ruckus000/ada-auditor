import { describe, expect, it } from 'vitest';
import { createAuditRunLog, emitAuditRunLog } from '../../src/services/audit-run-log';

describe('audit-run-log', () => {
  it('creates structured log fields', () => {
    const log = createAuditRunLog({
      journey: 'demo-login',
      env: 'staging',
      platform: 'generic',
      evidenceStatus: 'complete',
      ciStatus: 'pass',
      durationMs: 42,
      requestId: 'req-1',
    });

    expect(log.journey).toBe('demo-login');
    expect(log.ciStatus).toBe('pass');
  });

  it('emits JSON audit run log lines', () => {
    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (value: string) => {
      lines.push(value);
    };

    emitAuditRunLog({
      journey: 'demo-login',
      env: 'staging',
      platform: 'generic',
      evidenceStatus: 'degraded',
      ciStatus: 'inconclusive',
      durationMs: 10,
      requestId: 'req-2',
    });

    console.log = originalLog;

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('audit_run_log');
    expect(parsed.ciStatus).toBe('inconclusive');
    expect(parsed.requestId).toBe('req-2');
  });

  it('carries a negative headroom rather than clamping it', () => {
    // A run that outran its function is the single most interesting number this
    // product can produce, and it is produced on the failure path — which
    // recorded no timing at all until the walk got a clock. Clamping it at zero
    // would turn "the platform was about to kill this" into "it finished with
    // nothing to spare", which is a different sentence.
    const log = createAuditRunLog({
      journey: 'demo-login',
      env: 'staging',
      platform: 'unknown',
      evidenceStatus: 'unknown',
      ciStatus: 'unknown',
      durationMs: 310_000,
      failureReason: 'audit_run_failed',
      requestId: 'req-3',
      phaseMs: { journey: 300_000, upload: 900 },
      pagesAudited: 4,
      truncatedPages: 2,
      slowestPageMs: 41_000,
      headroomMs: -10_000,
    });

    expect(log.headroomMs).toBe(-10_000);
    expect(log.phaseMs?.journey).toBe(300_000);
    expect(log.pagesAudited).toBe(4);
  });
});
