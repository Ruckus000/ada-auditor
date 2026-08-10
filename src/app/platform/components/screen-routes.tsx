'use client';

import { clientView } from '../lib/derive';
import { usePlatform } from '../lib/state';
import { PortfolioScreen } from './portfolio';
import { ClientOverviewScreen } from './client-overview';
import { JourneysScreen } from './journeys';
import { FindingDetailScreen, FindingsListScreen } from './findings';
import { ReportBuilderScreen, ReportsLibraryScreen } from './reports';
import { ActivityScreen } from './activity';
import { SettingsScreen } from './settings';

/**
 * One client wrapper per route.
 *
 * The route pages are Server Components — that is where data loading lands in
 * the next slice — and the screens need the client-side context the provider
 * holds. These wrappers are the join: three lines each, no logic, and they
 * mean the screens themselves did not have to change when navigation moved to
 * the router.
 *
 * `clientView` is still a fixture read. When it becomes a query, it moves up
 * into the Server Component above each of these and arrives as a prop, which
 * is why every screen already takes one.
 */
function useClientView() {
  const { state } = usePlatform();
  return clientView(state.client, state.findOverrides);
}

export function PortfolioRoute() {
  return <PortfolioScreen />;
}

export function ClientOverviewRoute() {
  return <ClientOverviewScreen client={useClientView()} />;
}

export function JourneysRoute() {
  return <JourneysScreen client={useClientView()} />;
}

export function FindingsRoute() {
  return <FindingsListScreen client={useClientView()} />;
}

export function FindingDetailRoute() {
  return <FindingDetailScreen client={useClientView()} />;
}

export function ActivityRoute({ workspace = false }: { workspace?: boolean }) {
  const client = useClientView();
  return <ActivityScreen client={workspace ? null : client} />;
}

export function SettingsRoute({ workspace = false }: { workspace?: boolean }) {
  const client = useClientView();
  return <SettingsScreen client={workspace ? null : client} />;
}

/**
 * The library and the builder are one route with two states, because the
 * builder is reached by opening a report from the library and the URL says
 * which one is open (`/reports/2`).
 */
export function ReportsRoute({ workspace = false }: { workspace?: boolean }) {
  const { state } = usePlatform();
  const client = useClientView();

  if (state.reportOpen !== null) {
    return <ReportBuilderScreen client={client} />;
  }

  return <ReportsLibraryScreen client={workspace ? null : client} />;
}
