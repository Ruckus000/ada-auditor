'use client';

import { ClientOverviewScreen } from '../client-overview';
import { useClientView } from './use-client-view';

export function ClientOverviewRoute() {
  return <ClientOverviewScreen client={useClientView()} />;
}
