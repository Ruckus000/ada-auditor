import { notFound } from 'next/navigation';
import { reportCount } from '../../../platform/lib/derive';
import { ReportsRoute } from '../../../platform/components/screen-routes';

/**
 * The builder open on one report. Same component as the library — the URL says
 * which report is open, and `ReportsRoute` branches on it.
 *
 * The index is validated here because it now comes from the URL. Without this,
 * `/reports/6` hands the builder an undefined report and it throws on the
 * first field it reads, which with no error boundary is a blank page.
 */
export default async function WorkspaceReportBuilderPage({
  params,
}: {
  params: Promise<{ reportIndex: string }>;
}) {
  const { reportIndex } = await params;
  const index = Number(reportIndex);

  if (!Number.isInteger(index) || index < 0 || index >= reportCount()) {
    notFound();
  }

  return <ReportsRoute workspace />;
}
