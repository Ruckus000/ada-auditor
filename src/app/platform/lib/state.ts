'use client';

import { createContext, useContext } from 'react';
import type { Scope, WorkspaceScreen } from './params';

/**
 * The little that is not in the URL.
 *
 * This started as thirty fields in one `useState` — the prototype's entire
 * application state, including which screen you were on. Route state moved to
 * the URL in slice 1 and the fixture state went with the fixtures, leaving
 * exactly what has no business in an address bar: a toast.
 *
 * The rule that decided it is lifetime, not convenience. Where you are is
 * worth sending to a colleague; a message that fades in four seconds is not.
 */
export type { Scope, WorkspaceScreen } from './params';

export interface PlatformState {
  /**
   * Whether the current route is a workspace screen or a client screen.
   *
   * Derived from the pathname. The header needs it because `parseRoute` falls
   * back to `portfolio` for anything that is not a workspace path — so without
   * this, standing on `/clients/acme` marked the Portfolio tab as the current
   * page and highlighted it.
   */
  scope: Scope;
  /** Derived from the pathname; here so the header can highlight a tab. */
  screen: WorkspaceScreen;
  /**
   * Who the header says is signed in.
   *
   * Read from `AUDITOR_OPERATOR_NAME` on the server and passed down, because
   * the header is a client component and cannot read the environment. It said
   * "Jules Reyes" until now — a fabricated identity on every screen, in the
   * phase whose whole point was removing those.
   */
  operator: { name: string; initials: string };
  toast: { id: number; message: string } | null;
}

export const INITIAL_STATE: PlatformState = {
  scope: 'ws',
  screen: 'portfolio',
  operator: { name: 'Operator', initials: 'O' },
  toast: null,
};

export interface PlatformActions {
  patch: (next: Partial<PlatformState>) => void;
  flash: (message: string) => void;
  goWorkspace: (screen: WorkspaceScreen) => void;
}

export interface PlatformContextValue {
  state: PlatformState;
  actions: PlatformActions;
}

export const PlatformContext = createContext<PlatformContextValue | null>(null);

export function usePlatform(): PlatformContextValue {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('usePlatform must be used inside <PlatformApp>');
  return value;
}
