import { notFound } from 'next/navigation';
import { ClientOverview } from '../../../platform/components/client/client-overview';
import { loadClient } from './load';
import { guarded } from '../../guard';

export default guarded(async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await loadClient(clientId);

  // The layout has already answered 404 for this; the check is here so the
  // page's type is a `ClientDetail` rather than a nullable one.
  if (!detail) notFound();

  return <ClientOverview detail={detail} />;
});
