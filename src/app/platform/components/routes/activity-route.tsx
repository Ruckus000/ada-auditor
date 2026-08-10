'use client';

import { ActivityScreen } from '../activity';

/** Workspace-only: the client-scoped activity tab is gone with the fixtures. */
export function ActivityRoute() {
  return <ActivityScreen client={null} />;
}
