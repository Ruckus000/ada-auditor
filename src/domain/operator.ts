/**
 * Who did it.
 *
 * There are two kinds of caller and they are not the same thing:
 *
 *  - an **operator**, a person with an account, who signed in with an email
 *    and a password;
 *  - a **machine**, holding `AUDITOR_RUN_TOKEN` — CI, the chaos scripts, the
 *    scheduler, and an operator using the token as a way back in.
 *
 * Both are legitimate and both do real work, which is why `activity_events`
 * records a *name* in every case and an account id only when there was one.
 * A name and an account are different facts and the product needs both: the
 * name is what an activity feed reads back, the account is what makes
 * "assigned to" and per-operator revocation possible.
 *
 * `AUDITOR_OPERATOR_NAME` survives with a narrowed meaning — it names the
 * machine principal, so a scheduled run reads as something other than a blank.
 * It is no longer "the operator", because now there can be several.
 */

export type Principal =
  | { kind: 'operator'; id: string; name: string; email: string }
  | { kind: 'machine'; id?: undefined; name: string };

/** What `activity_events` stores: always a name, an account id when there is one. */
export function actorFields(principal: Principal): {
  actor: string;
  actorOperatorId?: string;
} {
  return {
    actor: principal.name,
    ...(principal.kind === 'operator' ? { actorOperatorId: principal.id } : {}),
  };
}

export function machinePrincipal(): Principal {
  return { kind: 'machine', name: operatorName() };
}

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
