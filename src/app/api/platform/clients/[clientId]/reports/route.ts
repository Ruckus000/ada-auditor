import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { actorFields } from '../../../../../../domain/operator';
import { getPlatformStore, getRunStore } from '../../../../../../integrations/persistence';
import { authorizePrincipal } from '../../../../_lib/authorize';
import { createRequestId } from '../../../../_lib/request-id';

/** Chromium is not involved, but `node:crypto` is: this cannot run on edge. */
export const runtime = 'nodejs';


/**
 * The reports issued for one client.
 *
 * Carries the share token, so this is operator-only like everything else under
 * `/api/platform` — a listing that leaked tokens would undo the point of them.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  const journeys = await platform.listJourneys(clientId);
  const runs = await Promise.all(
    journeys.map((journey) => getRunStore().list({ journeyId: journey.id, limit: 100 })),
  );
  const reports = await platform.listReports(runs.flat().map((run) => run.requestId));

  return Response.json({ requestId, reports, count: reports.length }, { status: 200 });
}

const createSchema = z.object({
  requestId: z.string().min(1).max(200),
  audience: z.enum(['legal', 'dev', 'exec']).optional(),
  title: z.string().trim().max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let parsed: z.infer<typeof createSchema>;
  try {
    parsed = createSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  const run = await getRunStore().getRun(parsed.requestId);
  if (!run) {
    return Response.json({ error: 'run_not_found', requestId }, { status: 404 });
  }

  // The run has to belong to this client. Without this check any operator
  // could mint a public link to any run by naming its id in a URL that says
  // somebody else — and the shared page carries the client's name on it.
  const journey = await platform.getJourney(run.journeyId);
  if (!journey || journey.clientId !== clientId) {
    return Response.json({ error: 'run_not_found', requestId }, { status: 404 });
  }

  const id = randomUUID();
  // 32 bytes, base64url. The token is the only thing standing between a public
  // URL and a client's audit findings, so it is generated rather than derived
  // from anything guessable, and it is long enough that enumeration is not a
  // strategy.
  const shareToken = randomBytes(32).toString('base64url');

  await platform.createReport({
    id,
    requestId: parsed.requestId,
    ...(parsed.audience ? { audience: parsed.audience } : {}),
    ...(parsed.title ? { title: parsed.title } : {}),
    issuedBy: principal.name,
    shareToken,
  });

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'issued a report',
    subject: parsed.title ?? parsed.requestId,
    metadata: { reportId: id, requestId: parsed.requestId },
  });

  return Response.json(
    { requestId, report: { id, shareToken, shareUrl: `/r/${shareToken}` } },
    { status: 201 },
  );
}

const revokeSchema = z.object({ id: z.string().min(1).max(200) });

/** Revoking clears the token. The row stays, so the history does not lie. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let parsed: z.infer<typeof revokeSchema>;
  try {
    parsed = revokeSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  const report = await platform.getReport(parsed.id);
  if (!report) {
    return Response.json({ error: 'report_not_found', requestId }, { status: 404 });
  }

  // Same ownership check as issuing: revoking somebody else's report is a
  // smaller harm than minting one, but it is still acting on another client's
  // record.
  const run = await getRunStore().getRun(report.requestId);
  const journey = run ? await platform.getJourney(run.journeyId) : null;
  if (!journey || journey.clientId !== clientId) {
    return Response.json({ error: 'report_not_found', requestId }, { status: 404 });
  }

  await platform.revokeShareToken(parsed.id);

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'revoked a report link',
    subject: report.title ?? report.requestId,
    metadata: { reportId: parsed.id },
  });

  return Response.json({ requestId, id: parsed.id }, { status: 200 });
}
