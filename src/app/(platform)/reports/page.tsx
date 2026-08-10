import { getPlatformStore, getRunStore } from '../../../integrations/persistence';
import { buildReports } from '../../../services/report-view';
import { ReportsScreen } from '../../platform/components/reports-screen';

export default async function WorkspaceReportsPage() {
  const platform = getPlatformStore();
  const reports = await buildReports({
    clients: platform,
    journeys: platform,
    reports: platform,
    runs: getRunStore(),
  });

  return <ReportsScreen reports={reports} />;
}
