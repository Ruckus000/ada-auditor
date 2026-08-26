import { notFound } from 'next/navigation';
import { ClientDocuments } from '../../../../platform/components/client/client-documents';
import { loadClient } from '../load';
import { guarded } from '../../../guard';

export default guarded(async function ClientDocumentsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await loadClient(clientId);

  if (!detail) notFound();

  // There is no client-level site URL — journeys carry `targetUrl` — so the
  // scan field prefills from the first journey that states one and stays
  // editable. A client with no journeys yet starts blank, which is honest:
  // nothing on record says where this client lives.
  const initialTargetUrl = detail.journeys.find((journey) => journey.targetUrl)?.targetUrl ?? '';

  return <ClientDocuments clientId={clientId} initialTargetUrl={initialTargetUrl} />;
});
