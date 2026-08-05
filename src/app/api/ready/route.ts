import { MIN_TOKEN_LENGTH } from '../_lib/console-session';

export async function GET() {
  const token = process.env.AUDITOR_RUN_TOKEN;
  const checks = {
    auditorRunTokenConfigured: typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH,
    chaosEnabled: process.env.CHAOS_ENABLED === 'true',
  };

  const ready = checks.auditorRunTokenConfigured;

  return Response.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
