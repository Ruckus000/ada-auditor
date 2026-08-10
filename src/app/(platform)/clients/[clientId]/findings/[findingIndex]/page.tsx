import { FindingDetailRoute } from '../../../../../platform/components/routes/findings-route';

/**
 * One finding, addressable.
 *
 * The prototype reached this screen by setting `state.findIndex`, so it could
 * not be linked, bookmarked or sent to the developer who has to fix it — which
 * is most of what a finding is for.
 */
export default function ClientFindingDetailPage() {
  return <FindingDetailRoute />;
}
