'use client';

import { createContext, useContext } from 'react';
import type { WorkspaceScreen } from './params';

/**
 * The little that is not in the URL.
 *
 * This started as thirty fields in one `useState` — the prototype's entire
 * application state, including which screen you were on. Route state moved to
 * the URL in slice 1 and the fixture state went with the fixtures, leaving
 * exactly what has no business in an address bar: an open modal and a toast.
 *
 * The rule that decided each one is lifetime, not convenience. Where you are
 * is worth sending to a colleague; a dialog you have open is not, and putting
 * it in the URL would make the back button close a dialog instead of
 * navigating.
 */
export type { WorkspaceScreen } from './params';

export type ModalName = 'addClient' | null;

export interface PlatformState {
  /** Derived from the pathname; here so the header can highlight a tab. */
  screen: WorkspaceScreen;
  modal: ModalName;
  toast: { id: number; message: string } | null;
}

export const INITIAL_STATE: PlatformState = {
  screen: 'portfolio',
  modal: null,
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
