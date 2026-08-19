'use client';

import { useRouter } from 'next/navigation';
import { T } from '../lib/tokens';
import { PlatformHeader } from './header';
import { Toast } from './toast';
import { UnlockCard } from '../../components/unlock-card';

/**
 * The chrome every platform screen sits inside.
 *
 * Split from the provider so that the provider is about state and this is
 * about layout. The route pages render only their screen; the header and the
 * toast live here once rather than in every page. The client bar is not here
 * — it belongs to the client routes, which is where it can be driven by a
 * record instead of by `state.client`.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ph-shell">
      <div className="ph-zoom">
        <PlatformHeader />

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
          {children}
        </main>

        <Toast />
      </div>
    </div>
  );
}

/**
 * What an unauthenticated visitor gets instead of the portfolio.
 *
 * Reuses the console's unlock card rather than growing a second way to prove
 * the same token: one secret, one flow, and rotating it locks both surfaces.
 * `router.refresh()` re-runs the server layout, which is what re-checks the
 * cookie — reloading the whole document would work too and would throw away
 * the rest of the page for no reason.
 */
export function PlatformLocked() {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: T.paper,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        <UnlockCard onUnlocked={() => router.refresh()} />
      </div>
    </div>
  );
}
