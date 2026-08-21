/**
 * The one announcement the authoring screens make to each other.
 *
 * `JourneyStepsEditor` and `VerifyButton` are siblings, composed by server
 * components in three wizard stages. A server component cannot pass a callback
 * to a client one, so the two halves of "save, then verify" have no prop to
 * meet on. This module is that meeting point: one name, one payload shape,
 * imported by both, so a rename cannot leave a dispatcher shouting into a
 * listener that stopped listening.
 *
 * Deliberately narrow. It is not an event bus and should not grow into one —
 * the moment a second kind of message wants to travel this way, the right
 * answer is almost certainly to restructure the components that need it into a
 * shared client parent instead.
 */

export const JOURNEY_STEPS_SAVED = 'ada-auditor:journey-steps-saved';

export type JourneyStepsSavedDetail = { journeyId: string };

/**
 * Reads the payload back, refusing anything that is not the shape above.
 *
 * A `CustomEvent`'s `detail` is `any` at the type level and arbitrary at
 * runtime — anything on the page can dispatch this name. The listener acts by
 * launching a browser walk that spends a budget, so it checks what it was
 * handed rather than trusting it.
 */
export function journeyIdFromSavedEvent(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const journeyId = (detail as { journeyId?: unknown }).journeyId;
  return typeof journeyId === 'string' && journeyId.length > 0 ? journeyId : null;
}
