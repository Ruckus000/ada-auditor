import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/ready/route';

describe('GET /api/ready', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;
  const originalChaos = process.env.CHAOS_ENABLED;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    if (originalChaos === undefined) delete process.env.CHAOS_ENABLED;
    else process.env.CHAOS_ENABLED = originalChaos;
  });

  it('is ready when AUDITOR_RUN_TOKEN meets MIN_TOKEN_LENGTH', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.checks.auditorRunTokenConfigured).toBe(true);
  });

  it('is not ready when the configured token is too short for auth', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'short';

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.auditorRunTokenConfigured).toBe(false);
  });

  it('is not ready when the token is missing', async () => {
    delete process.env.AUDITOR_RUN_TOKEN;

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.auditorRunTokenConfigured).toBe(false);
  });
});
