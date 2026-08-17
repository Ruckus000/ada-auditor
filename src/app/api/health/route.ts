export async function GET() {
  return Response.json({
    status: 'ok',
    service: 'ada-auditor',
    // Identifies *which* process answered. A caller that started a server and
    // wants to be sure it is talking to that server — rather than to something
    // else already holding the port — sets AUDITOR_INSTANCE_ID and checks it.
    instance: process.env.AUDITOR_INSTANCE_ID ?? null,
    timestamp: new Date().toISOString(),
  });
}
