'use client';

import { SettingsScreen } from '../settings';
import { useClientView } from './use-client-view';

export function SettingsRoute({ workspace = false }: { workspace?: boolean }) {
  const client = useClientView();
  return <SettingsScreen client={workspace ? null : client} />;
}
