'use client';

import type { PortfolioRow } from '../../../../services/portfolio';
import { PortfolioScreen } from '../portfolio';

export function PortfolioRoute({ clients }: { clients: PortfolioRow[] }) {
  return <PortfolioScreen clients={clients} />;
}
