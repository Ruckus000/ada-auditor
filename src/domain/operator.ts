/**
 * Who did it.
 *
 * There is no per-user identity in this product and no auth vendor — one
 * shared token, one trusted operator group. That was a deliberate Phase 2
 * decision, so activity is attributed to a configured *name* rather than to an
 * account: `activity_events.actor` is text, not a foreign key, and must not
 * grow into one without that decision being revisited.
 *
 * This replaces the string `"Jules Reyes"`, which was hardcoded in four
 * components and read as though the product knew who was signed in.
 */

const DEFAULT_OPERATOR = 'Operator';

export function operatorName(): string {
  const configured = process.env.AUDITOR_OPERATOR_NAME?.trim();
  return configured ? configured : DEFAULT_OPERATOR;
}

/**
 * Initials for the avatar.
 *
 * Two letters at most, from the first and last word — "Alex Reed" is AR,
 * "Operator" is O. Falls back rather than throwing on odd input, because a
 * misconfigured name should degrade an avatar, not a page.
 */
export function operatorInitials(name = operatorName()): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return DEFAULT_OPERATOR[0];
  }

  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';

  return `${first}${last}`.toUpperCase();
}
