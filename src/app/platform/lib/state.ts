'use client';

import { createContext, useContext } from 'react';
import type { Audience, FindingStatus } from './data';
import type { FindingFilter, FindingOverrides } from './derive';

export type WorkspaceScreen =
  | 'portfolio'
  | 'reports'
  | 'activity'
  | 'settings'
  | 'states'
  | 'coverage'
  | 'clientLink';

export type ClientTab =
  | 'overview'
  | 'journeys'
  | 'findings'
  | 'finding'
  | 'reports'
  | 'activity'
  | 'settings';

export type SettingsTab =
  | 'people'
  | 'tools'
  | 'reportDefaults'
  | 'display'
  | 'scanning'
  | 'standard'
  | 'schedule';

export type ModalName = 'generate' | 'audit' | 'dismiss' | 'undo' | 'invite' | null;

export interface UndoRow {
  who: string;
  action: string;
  target: string;
  when: string;
  client: string;
  detail: string;
}

export interface PlatformState {
  scope: 'ws' | 'client';
  screen: WorkspaceScreen;
  clientTab: ClientTab;
  client: number;
  modal: ModalName;
  undoRow: UndoRow | null;
  reportOpen: number | null;
  activityClient: string;
  settingsTab: SettingsTab;
  expanded: Record<string, boolean>;
  audience: Audience;
  findFilter: FindingFilter;
  findIndex: number;
  dismissReason: string;
  inviteRole: string;
  draft: boolean;
  dirty: boolean;
  findOverrides: FindingOverrides;
  undone: Record<string, boolean>;
  removedPaths: Record<string, string[]>;
  toggles: Record<string, boolean>;
  menu: string | null;
  picks: Record<string, string>;
  search: boolean;
  query: string;
  zoom: number;
  linkClient: string | null;
  linkReturn: 'ws' | 'client';
  toast: { id: number; message: string } | null;
  showReview: boolean;
  firstRun: boolean;
}

export const INITIAL_STATE: PlatformState = {
  scope: 'ws',
  screen: 'portfolio',
  clientTab: 'overview',
  client: 2,
  modal: null,
  undoRow: null,
  reportOpen: null,
  activityClient: 'all',
  settingsTab: 'people',
  expanded: {},
  audience: 'legal',
  findFilter: 'all',
  findIndex: 0,
  dismissReason: 'notApplicable',
  inviteRole: 'auditor',
  draft: false,
  dirty: false,
  findOverrides: {},
  undone: {},
  removedPaths: {},
  toggles: {},
  menu: null,
  picks: {},
  search: false,
  query: '',
  zoom: 1.15,
  linkClient: null,
  linkReturn: 'ws',
  toast: null,
  showReview: false,
  firstRun: false,
};

export interface PlatformActions {
  patch: (next: Partial<PlatformState>) => void;
  flash: (message: string) => void;
  toggle: (key: string, fallback: boolean) => { on: boolean; flip: () => void };
  menu: (
    key: string,
    label: string,
    options: string[],
  ) => {
    label: string;
    open: boolean;
    onToggle: () => void;
    options: Array<{ label: string; selected: boolean; onPick: () => void }>;
  };
  goWorkspace: (screen: WorkspaceScreen) => void;
  goClientTab: (tab: ClientTab) => void;
  openClient: (index: number) => void;
  setFindingStatus: (index: number, status: FindingStatus) => void;
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
