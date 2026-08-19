'use client';

import { useEffect, useRef } from 'react';

/**
 * The stage's h2, focused on mount. Stage changes re-render the server page,
 * so "on mount" is exactly "on stage change" — no state to coordinate.
 */
export function StageHeading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <h2
      ref={ref}
      tabIndex={-1}
      style={{
        margin: 0,
        fontSize: 19,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        // The heading is focused under ~150px of sticky chrome (56px header
        // + the ClientShell summary/tab bar pinned at top:56). Without a
        // scroll margin, `focus()` on a scrolled page parks the heading
        // underneath it — focused, announced, invisible.
        scrollMarginTop: 150,
      }}
    >
      {children}
    </h2>
  );
}
