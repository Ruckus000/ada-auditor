'use client';

import { usePlatform } from '../lib/state';
import { SHADOW } from '../lib/tokens';
import { CloseIcon } from './ui';

/**
 * One confirmation pattern for the whole tool: what happened, in plain
 * language. It lives in a polite live region so a screen reader hears the same
 * confirmation a sighted operator reads.
 */
export function Toast() {
  const { state, actions } = usePlatform();
  if (!state.toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="ph-toast"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 26,
        transform: 'translateX(-50%)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'min(560px, 92vw)',
        padding: '12px 14px',
        border: '1px solid #2b3a35',
        borderRadius: 11,
        background: '#1b2926',
        color: '#f6f3ec',
        boxShadow: SHADOW.toast,
      }}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#7fc9bd"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span style={{ fontSize: 12.5, lineHeight: 1.45, textWrap: 'pretty' }}>
        {state.toast.message}
      </span>
      <button
        type="button"
        onClick={() => actions.patch({ toast: null })}
        aria-label="Dismiss message"
        className="ph-toast-close"
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          flexShrink: 0,
          border: 'none',
          borderRadius: 6,
          background: 'none',
          color: '#9fb3ad',
          cursor: 'pointer',
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
