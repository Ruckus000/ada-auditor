'use client';

import { clientView } from '../../lib/derive';
import { usePlatform } from '../../lib/state';

/**
 * The client the report builder is about.
 *
 * The last fixture read of its kind. The client screens moved to real records
 * loaded in the Server Component above them; the report builder is slice 5,
 * and this goes with it.
 */
export function useClientView() {
  const { state } = usePlatform();
  return clientView(state.client, state.findOverrides);
}
