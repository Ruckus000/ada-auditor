import { notFound } from 'next/navigation';
import { getPlatformStore, getRunStore } from '../../../../../integrations/persistence';
import { buildFindingsView } from '../../../../../services/findings-view';
import { ClientFindings } from '../../../../platform/components/client/client-findings';

export default async function ClientFindingsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const platform = getPlatformStore();

  const view = await buildFindingsView(clientId, {
    clients: platform,
    journeys: platform,
    triage: platform,
    runs: getRunStore(),
  });

  // The layout has already answered 404 for an unknown client; this is here so
  // the component's prop is a `FindingsView` rather than a nullable one.
  if (!view) notFound();

  return <ClientFindings view={view} />;
}
