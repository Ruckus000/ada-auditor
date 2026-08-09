import { ReportsRoute } from '../../../platform/components/screen-routes';

/**
 * The builder open on one report. Same component as the library — the URL says
 * which report is open, and `ReportsRoute` branches on it.
 */
export default function WorkspaceReportBuilderPage() {
  return <ReportsRoute workspace />;
}
