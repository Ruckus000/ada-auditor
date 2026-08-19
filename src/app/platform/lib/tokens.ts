/**
 * Palette for the platform screens.
 *
 * These are the literal values from the `Platform Screens` design rather than
 * references to the console's CSS custom properties: the design is a distinct
 * surface (an agency worklist, not the operator console) and pinning the hexes
 * here keeps a later token rename from silently re-skinning it.
 */

export const T = {
  paper: '#f6f3ec',
  paperDeep: '#f3efe6',
  surface: '#fffdf9',
  surfaceSunk: '#f9f7f1',

  ink: '#131a1f',
  inkSoft: '#3a464e',
  inkMuted: '#55636b',
  // Darkened from #a9a294, which our own engine flagged: 2.36:1 on the sunk
  // surface and 2.49:1 on the raised one, against a 4.5:1 requirement. This
  // clears 4.64:1 and 4.89:1 and stays in the same warm-grey family. An
  // accessibility auditor failing contrast on its own chrome is the one bug
  // it cannot ship.
  inkFaint: '#74705f',
  chevron: '#8d8778',

  rule: '#ddd6c8',
  ruleStrong: '#c2b9a7',
  ruleFaint: '#ece7dc',

  accent: '#0b5f58',
  accentDeep: '#084a44',
  accentInk: '#084a44',
  accentWash: '#e3efec',
  accentWashDeep: '#f2f8f6',
  accentEdge: '#bcd9d2',

  fail: '#96231c',
  failDeep: '#7d1c16',
  failWash: '#fdf6f5',
  failWashDeep: '#fbeceb',
  failEdge: '#e6b3ae',

  caution: '#7a4e0a',
  cautionWash: '#fdf9f1',
  cautionWashDeep: '#fdf3e2',
  cautionEdge: '#dfba79',
  cautionEdgeSoft: '#e8dcc2',

  info: '#37507e',
  infoWash: '#eef1f6',
  infoEdge: '#c9d3e5',
} as const;

/**
 * `next/font` hashes the real family names, so the design's literal
 * `'Instrument Sans'` would silently fall back to a system face. The CSS
 * variables the root layout sets come first; the literal names stay behind them
 * for anyone rendering these components outside that layout.
 */
export const FONT = {
  sans: "var(--font-instrument), 'Instrument Sans', 'Segoe UI', system-ui, sans-serif",
  mono: "var(--font-jetbrains), 'JetBrains Mono', ui-monospace, monospace",
} as const;

/** Shared shadow recipes, lifted verbatim from the design. */
export const SHADOW = {
  menu: '0 14px 32px -12px rgba(19,26,31,0.3)',
  popover: '0 1px 2px rgba(19,26,31,0.06), 0 16px 36px -12px rgba(19,26,31,0.28)',
  toast: '0 18px 42px -14px rgba(19,26,31,0.6)',
  card: '0 1px 1px rgba(31,41,38,0.03)',
  paper: '0 1px 1px rgba(31,41,38,0.04), 0 20px 50px -24px rgba(31,41,38,0.4)',
} as const;
