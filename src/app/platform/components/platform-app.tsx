'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../platform.css';
import { clientView } from '../lib/derive';
import {
  INITIAL_STATE,
  PlatformContext,
  type ClientTab,
  type PlatformActions,
  type PlatformState,
  type WorkspaceScreen,
} from '../lib/state';
import type { FindingStatus } from '../lib/data';
import { T } from '../lib/tokens';
import { ClientBar, PlatformHeader } from './header';
import { PortfolioScreen } from './portfolio';
import { ClientOverviewScreen } from './client-overview';
import { JourneysScreen } from './journeys';
import { FindingDetailScreen, FindingsListScreen } from './findings';
import { ReportBuilderScreen, ReportsLibraryScreen } from './reports';
import { ActivityScreen } from './activity';
import { SettingsScreen } from './settings';
import { ClientLinkScreen, CoverageScreen, StatesScreen } from './review-screens';
import {
  DismissModal,
  GenerateReportModal,
  InviteModal,
  NewAuditModal,
  UndoModal,
} from './modals';
import { Toast } from './toast';

export interface PlatformAppProps {
  /** Reveals the States and Coverage review tabs in the header. */
  showReview?: boolean;
  /** Renders the portfolio in its no-clients-yet state. */
  firstRun?: boolean;
}

export function PlatformApp({ showReview = false, firstRun = false }: PlatformAppProps) {
  const [state, setState] = useState<PlatformState>(() => ({
    ...INITIAL_STATE,
    showReview,
    firstRun,
  }));
  const toastId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setState((prev) => ({ ...prev, showReview, firstRun }));
  }, [showReview, firstRun]);

  const patch = useCallback((next: Partial<PlatformState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  const flash = useCallback((message: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setState((prev) => ({ ...prev, toast: { id, message } }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      // Only clear if this is still the toast on screen; a newer message owns
      // the slot otherwise.
      setState((prev) => (prev.toast?.id === id ? { ...prev, toast: null } : prev));
    }, 4200);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ⌘K / Ctrl-K opens the client search from anywhere in the tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setState((prev) => ({ ...prev, search: true, query: '' }));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const actions = useMemo<PlatformActions>(
    () => ({
      patch,
      flash,
      toggle: (key, fallback) => ({
        on: key in state.toggles ? state.toggles[key] : fallback,
        flip: () =>
          setState((prev) => ({
            ...prev,
            toggles: {
              ...prev.toggles,
              [key]: !(key in prev.toggles ? prev.toggles[key] : fallback),
            },
          })),
      }),
      menu: (key, label, options) => {
        const current = state.picks[key] ?? label;
        return {
          label: current,
          open: state.menu === key,
          onToggle: () =>
            setState((prev) => ({ ...prev, menu: prev.menu === key ? null : key })),
          options: options.map((option) => ({
            label: option,
            selected: current === option,
            onPick: () =>
              setState((prev) => ({
                ...prev,
                menu: null,
                picks: { ...prev.picks, [key]: option },
              })),
          })),
        };
      },
      goWorkspace: (screen: WorkspaceScreen) =>
        setState((prev) => ({
          ...prev,
          scope: 'ws',
          screen,
          modal: null,
          reportOpen: null,
          draft: false,
          settingsTab: screen === 'settings' ? 'people' : prev.settingsTab,
        })),
      goClientTab: (tab: ClientTab) =>
        setState((prev) => ({
          ...prev,
          scope: 'client',
          clientTab: tab,
          modal: null,
          reportOpen: null,
          draft: false,
          settingsTab: tab === 'settings' ? 'scanning' : prev.settingsTab,
        })),
      openClient: (index: number) =>
        setState((prev) => ({
          ...prev,
          scope: 'client',
          client: index,
          clientTab: 'overview',
          modal: null,
          findFilter: 'all',
        })),
      setFindingStatus: (index: number, status: FindingStatus) =>
        setState((prev) => {
          const name = clientView(prev.client, prev.findOverrides).name;
          return {
            ...prev,
            findOverrides: {
              ...prev.findOverrides,
              [name]: { ...(prev.findOverrides[name] ?? {}), [index]: status },
            },
          };
        }),
    }),
    [patch, flash, state.toggles, state.picks, state.menu],
  );

  const client = clientView(state.client, state.findOverrides);
  const inClient = state.scope === 'client';
  const isBuilder =
    (state.screen === 'reports' || (inClient && state.clientTab === 'reports')) &&
    state.reportOpen !== null;

  return (
    <PlatformContext.Provider value={{ state, actions }}>
      <div className="ph-shell">
        <div className="ph-zoom" style={{ zoom: state.zoom }}>
          <PlatformHeader />
          {inClient ? <ClientBar client={client} /> : null}

          <main
            style={{
              flex: 1,
              width: '100%',
              maxWidth: 1720,
              margin: '0 auto',
              padding: '22px clamp(14px,1.8vw,28px) 40px',
              minWidth: 0,
            }}
          >
            {inClient && state.clientTab === 'overview' ? (
              <ClientOverviewScreen client={client} />
            ) : null}
            {inClient && state.clientTab === 'journeys' ? (
              <JourneysScreen client={client} />
            ) : null}
            {inClient && state.clientTab === 'findings' ? (
              <FindingsListScreen client={client} />
            ) : null}
            {inClient && state.clientTab === 'finding' ? (
              <FindingDetailScreen client={client} />
            ) : null}
            {!inClient && state.screen === 'portfolio' ? <PortfolioScreen /> : null}

            {(state.screen === 'reports' || (inClient && state.clientTab === 'reports')) &&
            !isBuilder ? (
              <ReportsLibraryScreen client={inClient ? client : null} />
            ) : null}
            {isBuilder ? <ReportBuilderScreen client={client} /> : null}

            {(!inClient && state.screen === 'activity') ||
            (inClient && state.clientTab === 'activity') ? (
              <ActivityScreen client={inClient ? client : null} />
            ) : null}
            {(!inClient && state.screen === 'settings') ||
            (inClient && state.clientTab === 'settings') ? (
              <SettingsScreen client={inClient ? client : null} />
            ) : null}
            {!inClient && state.screen === 'states' ? <StatesScreen /> : null}
            {!inClient && state.screen === 'coverage' ? <CoverageScreen /> : null}
            {!inClient && state.screen === 'clientLink' ? <ClientLinkScreen /> : null}
          </main>

          {/* Click-anywhere-else closes an open menu without stealing the click
              from the control that opened it. */}
          {state.menu ? (
            <div
              onClick={() => patch({ menu: null })}
              style={{ position: 'fixed', inset: 0, zIndex: 32 }}
            />
          ) : null}

          <Toast />

          {state.modal === 'generate' ? <GenerateReportModal client={client} /> : null}
          {state.modal === 'audit' ? <NewAuditModal /> : null}
          {state.modal === 'dismiss' ? <DismissModal client={client} /> : null}
          {state.modal === 'undo' ? <UndoModal /> : null}
          {state.modal === 'invite' ? <InviteModal client={client} /> : null}
        </div>
      </div>
    </PlatformContext.Provider>
  );
}

export const PLATFORM_BACKGROUND = T.paper;
