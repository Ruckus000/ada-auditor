import { z } from 'zod';
import { operatorName } from '../../../../domain/operator';
import { getPlatformStore, getRunStore } from '../../../../integrations/persistence';
import { buildPortfolio, clientIdFromName } from '../../../../services/portfolio';
import { hasOperatorSession } from '../../_lib/operator-session';
import { isRunAuthorized } from '../../_lib/auth';
import { isSameOriginConsoleRequest } from '../../_lib/same-origin';
import { createRequestId } from '../../_lib/request-id';

/**
 * The client catalog.
 *
 * The portfolio starts empty and operators add to it; nothing is seeded. That
 * is why this route exists at all — without it the product's front door would
 * be a screen with no way forward.
 *
 * Two ways to authenticate, and both are needed. The screens are a browser
 * calling same-origin with the operator session cookie; CI and scripts send
 * the bearer token. The layout's auth gate protects *rendering* only — an API
 * route is reachable directly and has to check for itself.
 */
async function authorize(request: Request): Promise<boolean> {
  if (isRunAuthorized(request)) {
    return true;
  }
  // A cookie alone is not enough for a state-changing request: it travels on
  // cross-site form posts too, which is what the same-origin check stops.
  return isSameOriginConsoleRequest(request) && (await hasOperatorSession());
}

export async function GET(request: Request) {
  const requestId = createRequestId();

  if (!(await authorize(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const platform = getPlatformStore();
  const clients = await buildPortfolio({
    clients: platform,
    journeys: platform,
    runs: getRunStore(),
  });

  return Response.json({ requestId, clients, count: clients.length }, { status: 200 });
}

const createClientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // A free-text name. There is no per-user identity to point at — see the
  // Phase 2 auth decision.
  owner: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const requestId = createRequestId();

  if (!(await authorize(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  let parsed: z.infer<typeof createClientSchema>;
  try {
    parsed = createClientSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  const platform = getPlatformStore();
  const existing = await platform.listClients();

  // The id is the URL, so a collision would show one client's findings under
  // another client's address. Suffixed rather than merged.
  const id = clientIdFromName(parsed.name, existing.map((client) => client.id));

  await platform.upsertClient({
    id,
    name: parsed.name,
    ...(parsed.owner ? { owner: parsed.owner } : {}),
  });

  await platform.recordEvent({
    clientId: id,
    actor: operatorName(),
    action: 'added a client',
    subject: parsed.name,
  });

  return Response.json({ requestId, client: { id, name: parsed.name } }, { status: 201 });
}
