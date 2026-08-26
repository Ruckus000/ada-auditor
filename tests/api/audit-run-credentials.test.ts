import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditReport } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { handleAuditRun } = await import('../../src/app/api/_lib/audit-run-handler');
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');

/**
 * How a run gets its stored credentials — and everything a run must NOT do
 * with them.
 *
 * The resolution *order* is `resolveCredentialFrom`'s and has its own tests;
 * these pin the handler's half: the journey's client is looked up, the store
 * is asked about exactly the refs the steps name, an unregistered journey
 * degrades to the env fallback rather than failing, and the values reach
 * `runBrowserAudit` and nowhere else — not the stored record, not its
 * `intent`, not a log line.
 */

const USER_SENTINEL = 'handler-user-sentinel@example.com';
const PASS_SENTINEL = 'hunter2-sentinel-handler';

const CREDENTIAL_STEPS = [
  { action: 'navigate', type: 'goto', path: '/login' },
  { action: 'login', type: 'fill', selector: '#u', credentialRef: 'portal', field: 'user' },
  { action: 'login', type: 'fill', selector: '#p', credentialRef: 'portal', field: 'pass' },
];

function runRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/audit/run?wait=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let platform: InstanceType<typeof MemoryPlatformStore>;
let runs: InstanceType<typeof MemoryRunStore>;

describe('handleAuditRun with stored credentials', () => {
  beforeEach(async () => {
    runBrowserAudit.mockReset();
    // Echoes the steps it was asked to walk, the way the real audit does —
    // `intent` is recorded from the report, so the sentinel assertions below
    // are about the same steps that carried the refs.
    runBrowserAudit.mockImplementation(async (input: { steps?: unknown[] }) => ({
      ...auditReport({ journeyId: 'stored-journey' }),
      steps: input.steps ?? [],
    }));

    runs = new MemoryRunStore();
    setRunStore(runs);
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);

    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'stored-journey',
      clientId: 'acme',
      name: 'Stored Journey',
      targetUrl: 'https://acme.test/',
      steps: CREDENTIAL_STEPS,
    });
    await platform.setClientCredential('acme', 'portal', {
      user: USER_SENTINEL,
      pass: PASS_SENTINEL,
    });
  });

  afterEach(() => {
    resetRunStore();
    resetPlatformStore();
    vi.restoreAllMocks();
  });

  it("hands the runner the store's values for the journey's client", async () => {
    const result = await handleAuditRun(
      runRequest({
        journeyId: 'stored-journey',
        environment: 'staging',
        targetUrl: 'https://acme.test/',
        steps: CREDENTIAL_STEPS,
      }),
      'req-cred-1',
    );

    expect(result.status).toBe(200);
    expect(runBrowserAudit.mock.calls[0][0].credentials).toEqual({
      portal: { user: USER_SENTINEL, pass: PASS_SENTINEL },
    });
  });

  it('passes nothing for a journey no client registered, leaving the env fallback to carry it', async () => {
    // `/api/audit/run` accepts any journeyId; one the catalog has never seen
    // has no client and therefore no stored credentials. That is the path
    // every pre-store caller is on, and it must not change under them.
    const result = await handleAuditRun(
      runRequest({
        journeyId: 'never-registered',
        environment: 'staging',
        targetUrl: 'https://acme.test/',
        steps: CREDENTIAL_STEPS,
      }),
      'req-cred-2',
    );

    expect(result.status).toBe(200);
    expect(runBrowserAudit.mock.calls[0][0]).not.toHaveProperty('credentials');
  });

  it('passes nothing for a ref the store does not hold', async () => {
    await platform.deleteClientCredential('acme', 'portal');

    await handleAuditRun(
      runRequest({
        journeyId: 'stored-journey',
        environment: 'staging',
        targetUrl: 'https://acme.test/',
        steps: CREDENTIAL_STEPS,
      }),
      'req-cred-3',
    );

    expect(runBrowserAudit.mock.calls[0][0]).not.toHaveProperty('credentials');
  });

  it('never lets a credential value into the stored run record or its intent', async () => {
    await handleAuditRun(
      runRequest({
        journeyId: 'stored-journey',
        environment: 'staging',
        targetUrl: 'https://acme.test/',
        steps: CREDENTIAL_STEPS,
      }),
      'req-cred-4',
    );

    const record = await runs.getRun('req-cred-4');
    expect(record).not.toBeNull();
    // `intent` stores steps, and steps carry refs only. The whole record is
    // grepped rather than chosen fields, because a value smuggled under any
    // key is the leak.
    const serialised = JSON.stringify(record);
    expect(serialised).toContain('portal');
    expect(serialised).not.toContain(USER_SENTINEL);
    expect(serialised).not.toContain(PASS_SENTINEL);
  });

  it('never lets a credential value reach a log line', async () => {
    // Everything `services/logger` emits lands on the console; catching all
    // three levels is catching every structured event this run produced.
    const lines: string[] = [];
    const capture = (line?: unknown) => {
      lines.push(String(line));
    };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture),
      vi.spyOn(console, 'error').mockImplementation(capture),
    ];

    try {
      await handleAuditRun(
        runRequest({
          journeyId: 'stored-journey',
          environment: 'staging',
          targetUrl: 'https://acme.test/',
          steps: CREDENTIAL_STEPS,
        }),
        'req-cred-5',
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = lines.join('\n');
    expect(output).toContain('req-cred-5');
    expect(output).not.toContain(USER_SENTINEL);
    expect(output).not.toContain(PASS_SENTINEL);
  });
});
