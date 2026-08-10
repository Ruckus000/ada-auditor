'use client';

import { ReportBuilderScreen, ReportsLibraryScreen } from '../reports';
import { usePlatform } from '../../lib/state';
import { useClientView } from './use-client-view';

/**
 * The library and the builder are one route with two states: the builder is
 * reached by opening a report from the library, and the URL says which one is
 * open (`/reports/2`).
 */
export function ReportsRoute({ workspace = false }: { workspace?: boolean }) {
  const { state } = usePlatform();
  const client = useClientView();

  if (state.reportOpen !== null) {
    return <ReportBuilderScreen client={client} />;
  }

  return <ReportsLibraryScreen client={workspace ? null : client} />;
}
