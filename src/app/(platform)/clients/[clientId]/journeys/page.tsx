import { notFound } from 'next/navigation';
import { ClientJourneys } from '../../../../platform/components/client/client-journeys';
import { loadClient } from '../load';

export default async function ClientJourneysPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await loadClient(clientId);

  if (!detail) notFound();

  return <ClientJourneys detail={detail} />;
}
