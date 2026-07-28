'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { glossaryAnchorId, glossaryEntry, type GlossaryKey } from './glossary';

const HOVER_OPEN_DELAY_MS = 120;
const HOVER_CLOSE_DELAY_MS = 180;

/**
 * An explanation affordance that satisfies WCAG 1.4.13 (Content on Hover or Focus):
 *
 * - Hoverable: the panel stays open while the pointer moves onto it, so its text
 *   can be read and selected.
 * - Dismissible: Escape closes it without moving focus.
 * - Persistent: it does not time out on its own.
 *
 * It is also a real <button>, so it is reachable by keyboard, and it is wired to
 * the labelled control with aria-describedby so screen reader users receive the
 * explanation without any pointer interaction at all.
 */
export function InfoTip({ termKey, className }: { termKey: GlossaryKey; className?: string }) {
  const entry = glossaryEntry(termKey);
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [shift, setShift] = useState(0);

  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleOpen = useCallback(() => {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS);
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    // Short grace period so the pointer can travel from trigger to panel.
    closeTimer.current = setTimeout(() => {
      setOpen((wasOpen) => (pinned ? wasOpen : false));
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearTimers, pinned]);

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPinned(false);
  }, [clearTimers]);

  // Escape dismisses without moving focus; outside clicks unpin.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        close();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Flip above/below and nudge horizontally so the panel never leaves the viewport.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !wrapRef.current) return;

    setShift(0);
    setPlacement('top');

    const trigger = wrapRef.current.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    const margin = 12;

    if (trigger.top - panel.height < margin) {
      setPlacement('bottom');
    }

    const centre = trigger.left + trigger.width / 2;
    const half = panel.width / 2;
    const overflowLeft = margin - (centre - half);
    const overflowRight = centre + half - (window.innerWidth - margin);

    if (overflowLeft > 0) setShift(overflowLeft);
    else if (overflowRight > 0) setShift(-overflowRight);
  }, [open]);

  return (
    <span className={className ? `infotip ${className}` : 'infotip'} ref={wrapRef}>
      <button
        type="button"
        className={`infotip-trigger${open ? ' is-open' : ''}`}
        aria-label={`Explain: ${entry.term}`}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          clearTimers();
          setOpen(true);
        }}
        onBlur={() => {
          if (!pinned) close();
        }}
        onClick={() => {
          clearTimers();
          if (pinned) {
            close();
          } else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        <span aria-hidden="true">?</span>
      </button>

      {open && (
        <span
          id={panelId}
          role="tooltip"
          ref={panelRef}
          className={`infotip-panel infotip-${placement}${pinned ? ' is-pinned' : ''}`}
          style={shift ? { transform: `translateX(calc(-50% + ${shift}px))` } : undefined}
          onMouseEnter={clearTimers}
          onMouseLeave={scheduleClose}
        >
          <span className="infotip-term">{entry.term}</span>
          <span className="infotip-short">{entry.short}</span>
          {pinned && entry.detail && <span className="infotip-detail">{entry.detail}</span>}
          {!pinned && entry.detail && (
            <span className="infotip-more" aria-hidden="true">
              Click for more
            </span>
          )}
          {pinned && (
            <a className="infotip-link" href={`#${glossaryAnchorId(termKey)}`} onClick={close}>
              See full glossary
            </a>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * A form label paired with its explanation. Keeps the two in sync at every call
 * site and guarantees the tip is never attached to the wrong control.
 */
export function FieldLabel({
  htmlFor,
  termKey,
  children,
}: {
  htmlFor: string;
  termKey: GlossaryKey;
  children: React.ReactNode;
}) {
  return (
    <span className="field-label-row">
      <label htmlFor={htmlFor}>{children}</label>
      <InfoTip termKey={termKey} />
    </span>
  );
}

/** A non-form label (a table heading, a status name) paired with its explanation. */
export function TermLabel({
  termKey,
  children,
  as: Tag = 'span',
}: {
  termKey: GlossaryKey;
  children: React.ReactNode;
  as?: 'span' | 'dt' | 'h3';
}) {
  return (
    <Tag className="term-label">
      {children}
      <InfoTip termKey={termKey} />
    </Tag>
  );
}
