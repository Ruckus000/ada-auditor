export async function GET() {
  return Response.json({
    status: 'ok',
    service: 'ada-auditor',
    timestamp: new Date().toISOString(),
  });
}
