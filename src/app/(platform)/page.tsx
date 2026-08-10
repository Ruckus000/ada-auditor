import { getPlatformStore, getRunStore } from '../../integrations/persistence';
import { buildPortfolio } from '../../services/portfolio';
import { PortfolioRoute } from '../platform/components/routes/portfolio-route';

/**
 * The portfolio, and the product's front door.
 *
 * It starts empty: operators add clients, nothing is seeded — including the
 * `client-unassigned` row that anchors journeys nobody registered, which
 * `listClients` leaves out.
 */
export default async function PortfolioPage() {
  const platform = getPlatformStore();
  const clients = await buildPortfolio({
    clients: platform,
    journeys: platform,
    runs: getRunStore(),
  });

  return <PortfolioRoute clients={clients} />;
}
