'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { SHADOW, T } from '../lib/tokens';

/* ------------------------------------------------------------ icons --- */

export function ChevronRight({ size = 17, color = T.chevron }: { size?: number; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function CloseIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/* ------------------------------------------------------------ chips --- */

export function Pill({
  bg,
  color,
  border,
  children,
  size = 10.5,
  padding = '3px 10px',
}: {
  bg: string;
  color: string;
  border: string;
  children: ReactNode;
  size?: number;
  padding?: string;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        padding,
        borderRadius: 999,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: '0.04em',
        background: bg,
        color,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Avatar({
  initials,
  size = 24,
  bg = T.accentWash,
  color = T.accentInk,
  fontSize = 10.5,
  title,
}: {
  initials: string;
  size?: number;
  bg?: string;
  color?: string;
  fontSize?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: bg,
        color,
        fontSize,
        fontWeight: 700,
      }}
    >
      {initials}
    </span>
  );
}

/* ----------------------------------------------------------- panels --- */

/**
 * `level` drops to 2 inside a client, where the sticky bar's client name is
 * already the page's h1. Two h1s on one page is the heading-structure defect
 * this product exists to report.
 */
export function ScreenHeading({
  title,
  lede,
  level = 1,
}: {
  title: string;
  lede?: ReactNode;
  level?: 1 | 2;
}) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Tag style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
        {title}
      </Tag>
      {lede ? (
        <p style={{ margin: 0, fontSize: 13, color: T.inkMuted, maxWidth: 760, textWrap: 'pretty' }}>
          {lede}
        </p>
      ) : null}
    </span>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${T.rule}`,
        borderRadius: 12,
        background: T.surface,
        overflowX: 'auto',
      }}
    >
      {children}
    </div>
  );
}

export function TableHead({ columns, template }: { columns: string[]; template: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: template,
        gap: 'clamp(8px,0.8vw,12px)',
        padding: '11px 18px',
        borderBottom: `1px solid ${T.rule}`,
        background: T.paperDeep,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.07em',
        color: T.inkMuted,
      }}
    >
      {columns.map((c, i) => (
        <span key={`${c}-${i}`}>{c}</span>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- modals --- */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  subtitle,
  onClose,
  width,
  children,
  screenLabel,
  hideClose = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  width: number;
  children: ReactNode;
  screenLabel: string;
  hideClose?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  // Kept current in an effect rather than during render: writing a ref while
  // rendering is what `react-hooks/refs` refuses, and the initial value above
  // already covers the first paint. The Escape handler below reads it, so it
  // calls the latest `onClose` without the keydown listener being torn down
  // and re-added on every render.
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // `aria-modal` is a promise to the user that the rest of the page is out of
  // reach. Without these three behaviours it is a lie: focus starts outside the
  // dialog, Tab walks straight out the back of it, and Escape does nothing.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = card.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;

      const stops = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];

      // Tabbing off either end wraps within the dialog rather than escaping to
      // the page behind it.
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Send focus back where it came from, so closing a dialog does not dump
      // the operator at the top of the document.
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      onClick={onClose}
      data-screen-label={screenLabel}
      className="ph-fade"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
        background: 'rgba(19,26,31,0.42)',
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="ph-modal-card"
        style={{
          width,
          maxWidth: '100%',
          maxHeight: '100%',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 15,
          padding: 22,
          border: `1px solid ${T.rule}`,
          borderRadius: 14,
          background: T.surface,
          boxShadow: SHADOW.modal,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.015em' }}>
              {title}
            </h2>
            {subtitle ? (
              <span style={{ fontSize: 12.5, color: T.inkMuted }}>{subtitle}</span>
            ) : null}
          </span>
          {hideClose ? null : (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ph-modal-close"
              style={{
                marginLeft: 'auto',
                width: 26,
                height: 26,
                border: `1px solid ${T.rule}`,
                borderRadius: 7,
                background: T.surface,
                color: T.inkMuted,
                fontSize: 12,
                cursor: 'pointer',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        paddingTop: 13,
        borderTop: `1px solid ${T.ruleFaint}`,
      }}
    >
      {children}
    </div>
  );
}
