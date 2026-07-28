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
});
