import { cache } from 'react';
import { getPlatformStore, getRunStore } from '../../../../integrations/persistence';
import { buildClientDetail, type ClientDetail } from '../../../../services/client-detail';

/**
 * One query per request, shared by the layout and the page beneath it.
 *
 * Both need the client — the layout to answer 404 and render the bar, the page
 * to render its contents — and React's `cache` deduplicates them within a
 * single render rather than making the page pass through props it cannot pass
 * (a layout cannot hand props to `children`).
 */
export const loadClient = cache(async (clientId: string): Promise<ClientDetail | null> => {
  const platform = getPlatformStore();
  return buildClientDetail(clientId, {
    clients: platform,
    journeys: platform,
    credentials: platform,
    runs: getRunStore(),
  });
});
