'use client';

import { clientView } from '../../lib/derive';
import { usePlatform } from '../../lib/state';

/**
 * The client the current route is about.
 *
 * Still a fixture read. When it becomes a query it moves up into the Server
 * Component above each route and arrives as a prop, which is why every screen
 * already takes one.
 */
export function useClientView() {
  const { state } = usePlatform();
  return clientView(state.client, state.findOverrides);
}
