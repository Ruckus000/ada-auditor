'use client';

import type { ReactNode } from 'react';
import { T } from '../lib/tokens';

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
