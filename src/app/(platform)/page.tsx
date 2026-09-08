import { getPlatformStore, getRunStore } from '../../integrations/persistence';
import { deliveryOverview } from '../../services/document-delivery';
import { buildPortfolio } from '../../services/portfolio';
import { PortfolioRoute } from '../platform/components/routes/portfolio-route';
import { guarded } from './guard';

/**
 * The portfolio, and the product's front door.
 *
 * It starts empty: operators add clients, nothing is seeded — including the
 * `client-unassigned` row that anchors journeys nobody registered, which
 * `listClients` leaves out.
 */
export default guarded(async function PortfolioPage() {
  const platform = getPlatformStore();
  const clients = await buildPortfolio({
    clients: platform,
    journeys: platform,
    runs: getRunStore(),
  });

  const rows = await Promise.all(clients.map(async client => client.contractType === 'audit' ? client : { ...client, deliveredDocumentCount: (await deliveryOverview(platform, client.id)).delivered }));
  return <PortfolioRoute clients={rows} />;
});
