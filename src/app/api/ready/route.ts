export async function GET() {
  const checks = {
    auditorRunTokenConfigured: Boolean(process.env.AUDITOR_RUN_TOKEN),
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
