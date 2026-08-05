'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { FONT, SHADOW, T } from '../lib/tokens';

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

export function SearchIcon({ color = 'currentColor', style }: { color?: string; style?: CSSProperties }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      style={{ flexShrink: 0, ...style }}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
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

export function Card({
  children,
  style,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  as?: 'div' | 'section';
}) {
  return (
    <Tag
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 18,
        border: `1px solid ${T.rule}`,
        borderRadius: 12,
        background: T.surface,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

export function SectionHeading({
  children,
  size = 14.5,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <h2 style={{ margin: 0, fontSize: size, fontWeight: 700, letterSpacing: 'normal' }}>
      {children}
    </h2>
  );
}

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

/* --------------------------------------------------------- controls --- */

export const primaryButton: CSSProperties = {
  padding: '8px 15px',
  border: 'none',
  borderRadius: 8,
  background: T.accent,
  color: '#fff',
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 650,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const ghostButton: CSSProperties = {
  padding: '7px 13px',
  border: `1px solid ${T.ruleStrong}`,
  borderRadius: 8,
  background: T.surface,
  color: T.inkSoft,
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const quietButton: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  color: T.accent,
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 650,
  cursor: 'pointer',
};

export function Switch({
  on,
  label,
  onFlip,
  accent = T.accent,
  style,
}: {
  on: boolean;
  label: string;
  onFlip: () => void;
  accent?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onFlip}
      className="ph-switch"
      style={
        {
          background: on ? accent : T.rule,
          '--ph-knob': on ? '15px' : '2px',
          ...style,
        } as CSSProperties
      }
    />
  );
}

export function SwitchRow({
  on,
  label,
  note,
  onFlip,
  accent,
}: {
  on: boolean;
  label: string;
  note?: string;
  onFlip: () => void;
  accent?: string;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <Switch on={on} label={label} onFlip={onFlip} accent={accent} style={{ marginTop: 1 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        {note ? (
          <span style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.4, textWrap: 'pretty' }}>
            {note}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function RadioDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 15,
        height: 15,
        borderRadius: '50%',
        border: `1.5px solid ${on ? T.accent : T.ruleStrong}`,
        background: on ? T.accent : T.surface,
        flexShrink: 0,
        marginTop: 2,
        boxShadow: on ? `inset 0 0 0 2.5px ${T.surface}` : 'none',
      }}
    />
  );
}

export function RadioCard({
  on,
  label,
  note,
  onPick,
}: {
  on: boolean;
  label: string;
  note: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className="ph-accent-hover"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        border: `1.5px solid ${on ? T.accent : T.rule}`,
        borderRadius: 10,
        background: on ? T.accentWashDeep : T.surface,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: FONT.sans,
      }}
    >
      <RadioDot on={on} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: T.ink }}>{label}</span>
        <span style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.4, textWrap: 'pretty' }}>
          {note}
        </span>
      </span>
    </button>
  );
}

export interface MenuState {
  label: string;
  open: boolean;
  onToggle: () => void;
  options: Array<{ label: string; selected: boolean; onPick: () => void }>;
  width?: number;
  top?: number;
}

export function DropMenu({ menu, compact = false }: { menu: MenuState; compact?: boolean }) {
  return (
    <span
      style={{ position: 'relative' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && menu.open) menu.onToggle();
      }}
    >
      <button
        type="button"
        onClick={menu.onToggle}
        aria-expanded={menu.open}
        aria-haspopup="true"
        className="ph-ghost"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: compact ? '6px 12px' : '7px 13px',
          border: `1px solid ${T.ruleStrong}`,
          borderRadius: 8,
          background: T.surface,
          fontFamily: FONT.sans,
          fontSize: compact ? 12 : 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          color: T.ink,
        }}
      >
        {menu.label}
        <span aria-hidden="true" style={{ color: T.inkMuted, fontSize: 11 }}>
          ▾
        </span>
      </button>
      {menu.open ? (
        // Deliberately not `role="menu"`: that role promises arrow-key
        // navigation this control does not implement, and would strip the
        // buttons out of the Tab order a keyboard user actually gets. A plain
        // group of toggle buttons is what this is.
        <span
          role="group"
          aria-label={menu.label}
          className="ph-pop-menu"
          style={{
            position: 'absolute',
            top: menu.top ?? 38,
            right: 0,
            zIndex: 35,
            display: 'flex',
            flexDirection: 'column',
            minWidth: menu.width ?? 206,
            padding: 5,
            border: `1px solid ${T.rule}`,
            borderRadius: 10,
            background: T.surface,
            boxShadow: SHADOW.menu,
          }}
        >
          {menu.options.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={option.selected}
              onClick={option.onPick}
              className="ph-menu-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 9px',
                border: 'none',
                borderRadius: 7,
                background: 'none',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                fontFamily: FONT.sans,
                fontSize: 12.5,
                color: T.inkSoft,
                cursor: 'pointer',
              }}
            >
              <span aria-hidden="true" style={{ width: 12, color: T.accent, fontWeight: 700 }}>
                {option.selected ? '✓' : ''}
              </span>
              {option.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function FilterChip({
  label,
  count,
  active,
  onPick,
}: {
  label: string;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className="ph-accent-hover"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 12px',
        border: `1px solid ${active ? T.accent : T.rule}`,
        borderRadius: 999,
        background: active ? T.accent : T.surface,
        color: active ? '#fff' : T.inkSoft,
        fontFamily: FONT.sans,
        fontSize: 12,
        fontWeight: active ? 650 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
      <span style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.72)' : T.inkMuted }}>
        {count}
      </span>
    </button>
  );
}

export function ReadOnlyField({
  label,
  value,
  mono = false,
  caret = false,
  placeholder = false,
  accentBorder = false,
  minHeight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  caret?: boolean;
  placeholder?: boolean;
  accentBorder?: boolean;
  minHeight?: number;
}) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label ? (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>{label}</span>
      ) : null}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 13px',
          border: accentBorder ? `1.5px solid ${T.accent}` : `1px solid ${T.ruleStrong}`,
          borderRadius: 9,
          background: T.surface,
          fontFamily: mono ? FONT.mono : FONT.sans,
          fontSize: 12.5,
          color: placeholder ? T.inkFaint : T.inkSoft,
          minHeight,
          lineHeight: 1.5,
        }}
      >
        {value}
        {caret ? (
          <span aria-hidden="true" style={{ marginLeft: 'auto', color: T.inkMuted, fontSize: 11 }}>
            ▾
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: T.inkMuted,
      }}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------- modals --- */

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
  closeRef.current = onClose;

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
