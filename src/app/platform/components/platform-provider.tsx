'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import {
  clientHref,
  findingHref,
  menuValue,
  parseRoute,
  parseSearch,
  reportHref,
  withMenu,
  workspaceHref,
  type MenuKey,
} from '../lib/params';
import { slugForIndex, indexForSlug } from '../lib/client-slugs';

/**
 * Holds what the URL cannot, and derives everything else from it.
 *
 * The prototype kept all thirty state fields in one `useState`, so navigating
 * changed nothing about the address bar: no deep links, no back button, and
 * six filter menus whose chosen value was read only by their own label.
 *
 * The split is by lifetime, not by convenience:
 *
 * - **Route and filter state lives in the URL.** Where you are and what you
 *   filtered by are things you should be able to send to a colleague.
 * - **Ephemeral state stays here.** An open modal, a toast, a half-typed
 *   dismissal reason and an expanded row are not worth a URL, and putting them
 *   in one would make the back button undo a dialog instead of a navigation.
 *
 * Screens keep calling `usePlatform()` and reading `state.clientTab` exactly as
 * before. Only this file knows that some of those fields now come from the
 * router, which is why the restructure did not touch ten screen files.
 */

/** Fields the URL owns. Anything else is ephemeral and lives in `useState`. */
const ROUTED_KEYS = [
  'scope',
  'screen',
  'clientTab',
  'client',
  'findIndex',
  'reportOpen',
  'settingsTab',
  'audience',
  'findFilter',
] as const;

type RoutedKey = (typeof ROUTED_KEYS)[number];

function isRouted(key: string): key is RoutedKey {
  return (ROUTED_KEYS as readonly string[]).includes(key);
}

export interface PlatformProviderProps {
  showReview?: boolean;
  firstRun?: boolean;
  children: React.ReactNode;
}

export function PlatformProvider({
  showReview = false,
  firstRun = false,
  children,
}: PlatformProviderProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();

  const route = useMemo(() => parseRoute(pathname), [pathname]);
  const search = useMemo(
    () => parseSearch(searchParams ?? new URLSearchParams()),
    [searchParams],
  );

  /**
   * Everything the URL does not own.
   *
   * Seeded from `INITIAL_STATE` so nothing downstream has to learn a second
   * shape — the routed fields in here are overwritten on every render below.
   */
  const [ephemeral, setEphemeral] = useState<PlatformState>(() => ({
    ...INITIAL_STATE,
    showReview,
    firstRun,
  }));

  const toastId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setEphemeral((prev) => ({ ...prev, showReview, firstRun }));
  }, [showReview, firstRun]);

  const clientIndex = indexForSlug(route.clientSlug);

  const state: PlatformState = useMemo(
    () => ({
      ...ephemeral,
      scope: route.scope,
      screen: route.screen,
      clientTab: route.clientTab,
      client: clientIndex,
      findIndex: route.findIndex,
      reportOpen: route.reportOpen,
      settingsTab: search.settingsTab,
      audience: search.audience,
      findFilter: search.filter,
    }),
    [ephemeral, route, search, clientIndex],
  );

  const currentSlug = route.clientSlug ?? slugForIndex(clientIndex);

  const flash = useCallback((message: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setEphemeral((prev) => ({ ...prev, toast: { id, message } }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      // Only clear if this is still the toast on screen; a newer message owns
      // the slot otherwise.
      setEphemeral((prev) => (prev.toast?.id === id ? { ...prev, toast: null } : prev));
    }, 4200);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // ⌘K / Ctrl-K opens the client search from anywhere in the tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setEphemeral((prev) => ({ ...prev, search: true, query: '' }));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Routes what the URL owns and stores the rest.
   *
   * Fifty call sites across the screens patch state without caring which kind
   * it is, so the split happens here rather than at every one of them.
   */
  const patch = useCallback(
    (next: Partial<PlatformState>) => {
      const routed = Object.keys(next).filter(isRouted) as RoutedKey[];
      const ephemeralKeys = Object.keys(next).filter((key) => !isRouted(key));

      if (ephemeralKeys.length > 0) {
        const slice: Partial<PlatformState> = {};
        for (const key of ephemeralKeys) {
          (slice as Record<string, unknown>)[key] = (next as Record<string, unknown>)[key];
        }
        setEphemeral((prev) => ({ ...prev, ...slice }));
      }

      if (routed.length === 0) {
        return;
      }

      const merged = { ...state, ...next };
      const nextSearch = {
        filter: merged.findFilter,
        audience: merged.audience,
        settingsTab: merged.settingsTab,
      };

      const slug = merged.client === clientIndex ? currentSlug : slugForIndex(merged.client);

      if (merged.scope === 'client' && slug) {
        if (merged.clientTab === 'finding') {
          router.push(findingHref(slug, merged.findIndex, nextSearch));
          return;
        }
        if (merged.clientTab === 'reports' && merged.reportOpen !== null) {
          router.push(reportHref(slug, merged.reportOpen, nextSearch));
          return;
        }
        router.push(clientHref(slug, merged.clientTab, nextSearch));
        return;
      }

      if (merged.screen === 'reports' && merged.reportOpen !== null) {
        router.push(reportHref(null, merged.reportOpen, nextSearch));
        return;
      }

      router.push(workspaceHref(merged.screen, nextSearch));
    },
    [router, state, clientIndex, currentSlug],
  );

  const actions = useMemo<PlatformActions>(
    () => ({
      patch,
      flash,
      toggle: (key, fallback) => ({
        on: key in ephemeral.toggles ? ephemeral.toggles[key] : fallback,
        flip: () =>
          setEphemeral((prev) => ({
            ...prev,
            toggles: {
              ...prev.toggles,
              [key]: !(key in prev.toggles ? prev.toggles[key] : fallback),
            },
          })),
      }),
      /**
       * A menu writes its choice to the URL.
       *
       * It used to write to `state.picks`, which nothing read except the
       * menu's own label — six controls that looked like filters and filtered
       * nothing. They still carry a label rather than a query value, but the
       * choice now survives a reload and a shared link, and there is one
       * obvious place for the slice that gives them meaning to hook into.
       */
      menu: (key, label, options) => {
        const params = searchParams ?? new URLSearchParams();
        const current = menuValue(params, key as MenuKey, label);
        return {
          label: current,
          open: ephemeral.menu === key,
          onToggle: () =>
            setEphemeral((prev) => ({ ...prev, menu: prev.menu === key ? null : key })),
          options: options.map((option) => ({
            label: option,
            selected: current === option,
            onPick: () => {
              setEphemeral((prev) => ({ ...prev, menu: null }));
              router.push(withMenu(pathname, params, key as MenuKey, option, label));
            },
          })),
        };
      },
      goWorkspace: (screen: WorkspaceScreen) => {
        setEphemeral((prev) => ({ ...prev, modal: null, draft: false }));
        router.push(
          workspaceHref(screen, {
            // The prototype reset the settings tab on entry; a URL that says
            // otherwise wins, which is what makes a settings deep link work.
            settingsTab: screen === 'settings' ? 'people' : search.settingsTab,
          }),
        );
      },
      goClientTab: (tab: ClientTab) => {
        setEphemeral((prev) => ({ ...prev, modal: null, draft: false }));
        if (!currentSlug) return;
        router.push(
          clientHref(currentSlug, tab, {
            settingsTab: tab === 'settings' ? 'scanning' : search.settingsTab,
          }),
        );
      },
      openClient: (index: number) => {
        setEphemeral((prev) => ({ ...prev, modal: null }));
        const slug = slugForIndex(index);
        if (slug) router.push(clientHref(slug));
      },
      setFindingStatus: (index: number, status: FindingStatus) =>
        setEphemeral((prev) => {
          const name = clientView(clientIndex, prev.findOverrides).name;
          return {
            ...prev,
            findOverrides: {
              ...prev.findOverrides,
              [name]: { ...(prev.findOverrides[name] ?? {}), [index]: status },
            },
          };
        }),
    }),
    [
      patch,
      flash,
      ephemeral.toggles,
      ephemeral.menu,
      searchParams,
      pathname,
      router,
      search.settingsTab,
      currentSlug,
      clientIndex,
    ],
  );

  return (
    <PlatformContext.Provider value={{ state, actions }}>{children}</PlatformContext.Provider>
  );
}
