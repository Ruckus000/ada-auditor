import { z } from 'zod';
import { CREDENTIAL_REF_PATTERN } from '../../../../../../../domain/credential-ref';
import { actorFields } from '../../../../../../../domain/operator';
import { getPlatformStore } from '../../../../../../../integrations/persistence';
import { isCredentialStoreConfigured } from '../../../../../../../integrations/persistence/credential-cipher';
import { authorizePrincipal } from '../../../../../_lib/authorize';
import { createRequestId } from '../../../../../_lib/request-id';

/**
 * Write one client credential; remove one. Nothing here ever reads one out.
 *
 * The steady-state rule is unchanged — credentials are referenced, never
 * inlined — and this is the boundary that makes the *reference* resolve
 * without a hand on the deployment's environment. The value crosses the wire
 * exactly once, inbound, over the operator's authenticated same-origin
 * session; every response, event and log line after that carries the ref and
 * nothing else. `resolvedSecrets` redaction covers the run; this surface's
 * job is to have nothing to redact.
 *
 * The 512 cap is deliberately roomy — some SSO passwords are pass-phrases —
 * and exists so a request body cannot be used to park arbitrary blobs in an
 * encrypted column nothing can inspect.
 */
const valuesSchema = z.object({
  user: z.string().min(1).max(512),
  pass: z.string().min(1).max(512),
});

/**
 * The same pattern the journey step schema holds `credentialRef` to, imported
 * rather than respelled — a ref writable here but unusable in a step (or the
 * reverse) would be two doors disagreeing about one rule.
 */
function invalidRef(ref: string): boolean {
  return !CREDENTIAL_REF_PATTERN.test(ref);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ clientId: string; ref: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, ref } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  if (invalidRef(ref)) {
    return Response.json({ error: 'invalid_credential_ref', requestId }, { status: 400 });
  }

  // Refused before the body is even parsed: without a key the store cannot
  // write anything it could ever read back, so accepting the value would be a
  // lie with a 200 on it. 503 rather than 500 because the deployment is
  // degraded, not broken — env-var credentials still resolve.
  if (!isCredentialStoreConfigured()) {
    return Response.json({ error: 'credential_store_not_configured', requestId }, { status: 503 });
  }

  let values: z.infer<typeof valuesSchema>;
  try {
    values = valuesSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  await platform.setClientCredential(clientId, ref, values);

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'stored a credential',
    subject: ref,
    // The ref and nothing else. The feed is append-only and read back by
    // screens, so anything more here is a secret with an audience.
    metadata: { ref },
  });

  // Presence, never an echo. `fields` names what was set so the screen can
  // confirm the write without the response carrying what was written.
  return Response.json({ requestId, ref, fields: ['user', 'pass'] }, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clientId: string; ref: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, ref } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  if (invalidRef(ref)) {
    return Response.json({ error: 'invalid_credential_ref', requestId }, { status: 400 });
  }

  // No key check: deleting decrypts nothing, and refusing would strand rows
  // in a deployment that lost its key — the exact situation where an operator
  // most wants to clear and re-enter.
  await platform.deleteClientCredential(clientId, ref);

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'removed a credential',
    subject: ref,
    metadata: { ref },
  });

  return Response.json({ requestId, ref }, { status: 200 });
}
