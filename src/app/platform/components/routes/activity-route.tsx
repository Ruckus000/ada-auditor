'use client';

import { ActivityScreen } from '../activity';
import { useClientView } from './use-client-view';

export function ActivityRoute({ workspace = false }: { workspace?: boolean }) {
  const client = useClientView();
  return <ActivityScreen client={workspace ? null : client} />;
}
