'use client';

import { SettingsScreen } from '../settings';

/** Workspace-only: the client-scoped settings tab is gone with the fixtures. */
export function SettingsRoute() {
  return <SettingsScreen client={null} />;
}
