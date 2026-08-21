import { FONT, T } from './tokens';

/**
 * The form field styles the platform's own screens share.
 *
 * Byte-identical copies of these lived at the bottom of `new-client-screen`
 * and `where-screen`, which is one edit away from two screens in the same
 * wizard drawing the same field differently.
 */

export const labelStyle = {
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 650,
  color: T.inkSoft,
} as const;

export const inputStyle = {
  padding: '9px 11px',
  borderRadius: 8,
  border: `1px solid ${T.rule}`,
  background: '#fff',
  fontFamily: FONT.sans,
  fontSize: 13.5,
  color: T.ink,
} as const;

/** The small grey line under a field, and the always-mounted live regions. */
export const noteStyle = {
  fontFamily: FONT.sans,
  fontSize: 11.5,
  color: T.inkMuted,
} as const;

export const errorStyle = {
  margin: 0,
  padding: '9px 12px',
  borderRadius: 8,
  background: T.failWash,
  border: `1px solid ${T.failEdge}`,
  color: T.failDeep,
  fontFamily: FONT.sans,
  fontSize: 12.5,
} as const;
