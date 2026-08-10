'use client';

import { FindingDetailScreen, FindingsListScreen } from '../findings';
import { useClientView } from './use-client-view';

export function FindingsRoute() {
  return <FindingsListScreen client={useClientView()} />;
}

export function FindingDetailRoute() {
  return <FindingDetailScreen client={useClientView()} />;
}
