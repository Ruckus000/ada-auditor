'use client';

import { JourneysScreen } from '../journeys';
import { useClientView } from './use-client-view';

export function JourneysRoute() {
  return <JourneysScreen client={useClientView()} />;
}
