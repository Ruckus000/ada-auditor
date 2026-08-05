import { z } from 'zod';
import { isRunAuthorized } from '../../../_lib/auth';
import { createRequestId } from '../../../_lib/request-id';
import { getRunStore } from '../../../../../integrations/persistence';
import { compareToBaseline } from '../../../../../services/regression';

const querySchema = z.object({
  journeyId: z.string().min(1),
  environment: z.enum(['production', 'preview', 'staging', 'test']),
});

export async function GET(request: Request) {
  const requestId = createRequestId();

  if (!isRunAuthorized(request)) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    journeyId: url.searchParams.get('journeyId') ?? undefined,
    environment: url.searchParams.get('environment') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'invalid_query', requestId }, { status: 400 });
  }

  const store = getRunStore();
  const run = await store.getLatestRun(parsed.data.journeyId, parsed.data.environment);

  if (!run) {
    return Response.json({ error: 'run_not_found', requestId }, { status: 404 });
  }

  const baseline = await store.getLatestRun(
    parsed.data.journeyId,
    parsed.data.environment,
    run.requestId,
  );
  const regression = baseline ? compareToBaseline(run, baseline) : undefined;

  return Response.json(
    {
      requestId,
      run,
      regression,
    },
    { status: 200 },
  );
}
