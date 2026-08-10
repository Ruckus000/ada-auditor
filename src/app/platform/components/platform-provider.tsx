'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import '../platform.css';
import {
  INITIAL_STATE,
  PlatformContext,
  type PlatformActions,
  type PlatformState,
  type WorkspaceScreen,
} from '../lib/state';
import { parseRoute, workspaceHref } from '../lib/params';

/**
 * Holds what the URL cannot, and derives everything else from it.
 *
 * The prototype kept all thirty state fields in one `useState`, so navigating
 * changed nothing about the address bar: no deep links, no back button, and
 * six filter menus whose chosen value was read only by their own label.
 *
 * What is left after the fixtures went is small enough to see at a glance: the
 * screen comes from the pathname, and a modal and a toast live here because
 * neither belongs in a URL.
 */
export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  const route = useMemo(() => parseRoute(pathname), [pathname]);

  const [ephemeral, setEphemeral] = useState<PlatformState>(INITIAL_STATE);
  const toastId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const state: PlatformState = useMemo(
    () => ({ ...ephemeral, screen: route.screen }),
    [ephemeral, route.screen],
  );

  const flash = useCallback((message: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setEphemeral((prev) => ({ ...prev, toast: { id, message } }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      // Only clear if this is still the toast on screen; a newer message owns
      // the slot otherwise.
      setEphemeral((prev) => (prev.toast?.id === id ? { ...prev, toast: null } : prev));
    }, 4000);
  }, []);

  const actions = useMemo<PlatformActions>(
    () => ({
      patch: (next) => setEphemeral((prev) => ({ ...prev, ...next })),
      flash,
      goWorkspace: (screen: WorkspaceScreen) => {
        setEphemeral((prev) => ({ ...prev, modal: null }));
        router.push(workspaceHref(screen));
      },
    }),
    [flash, router],
  );

  return (
    <PlatformContext.Provider value={{ state, actions }}>{children}</PlatformContext.Provider>
  );
}
