import { notFound } from 'next/navigation';
import { reportCount } from '../../../../../platform/lib/derive';
import { ReportsRoute } from '../../../../../platform/components/routes/reports-route';

/** Same index guard as the workspace builder — see that route for why. */
export default async function ClientReportBuilderPage({
  params,
}: {
  params: Promise<{ reportIndex: string }>;
}) {
  const { reportIndex } = await params;
  const index = Number(reportIndex);

  if (!Number.isInteger(index) || index < 0 || index >= reportCount()) {
    notFound();
  }

  return <ReportsRoute />;
}
