import type { MouseEvent } from 'react';

/**
 * A control that is unavailable without dropping the keyboard user's place.
 *
 * `disabled` removes a button from the tab order. When the thing that disables
 * it is the click itself — "Run now" becoming busy, "Save steps" becoming
 * saving — the browser takes focus off the control mid-interaction and focus
 * falls to `<body>`. The operator then tabs from the top of the document, past
 * the whole workspace nav, to get back to the control they just used. Nothing
 * reports this: the markup is valid and the control is correctly marked
 * disabled, so axe passes. It was found by reading the flow as a keyboard-only
 * user, which is the only way it can be found.
 *
 * Three ways out, and only one of them keeps both halves:
 *
 *  1. Leave focus on `<body>`. Keeps the `role="status"` confirmation, loses
 *     the operator's place.
 *  2. Move focus somewhere else — the address box, an emptied field. Restores a
 *     place, but announcing the newly focused control interrupts the polite
 *     live region on several screen-reader/browser pairs, so the confirmation
 *     is lost.
 *  3. This. `aria-disabled="true"` plus an early return in the handler. The
 *     control never leaves the tab order, so focus is never taken from it and
 *     no other control has to be announced to hold it: the confirmation *and*
 *     the position survive, which the two-option framing had treated as a
 *     trade.
 *
 * The early return is not optional decoration. `aria-disabled` is a claim made
 * to assistive technology and nothing else — the button still takes clicks, and
 * Enter or Space on a focused button *is* a click. Bundling the attribute and
 * the guard into one call is what stops a call site shipping the claim without
 * the behaviour behind it.
 *
 * What this does not do is style the control. An inert button that still looks
 * live is its own defect, so every call site pairs this with the muted
 * treatment it already used for `disabled`.
 *
 * **`react-hooks/refs` reports a call site whose handler touches a ref, and
 * the report is wrong here.** The rule refuses ref access during render, and
 * it treats a function passed *as an argument to a call made during render* as
 * one that call might invoke. This function never invokes the handler: it
 * closes over it and returns a wrapper the browser calls on click. Nothing
 * above ever runs during a render.
 *
 * That is the analysis; here is the evidence, so nobody has to re-derive it.
 * Replace `{...inertWhen(busy, start)}` with a plain `onClick={start}` and the
 * report disappears while `start` still touches exactly the same ref — so what
 * the rule objects to is the argument position, not the ref. The three sites
 * that trip it suppress it on that line and point here. Sites whose handler
 * touches no ref — the two in `discover-pages.tsx` — do not trip it at all,
 * which is the other half of the same demonstration.
 *
 * Suppressed rather than designed around, because every way around it splits
 * the attribute from the guard, and keeping those two together is the entire
 * reason this function exists.
 */
export function inertWhen(
  isInert: boolean,
  onClick: (event: MouseEvent<HTMLButtonElement>) => void,
): {
  'aria-disabled': true | undefined;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
} {
  return {
    // Omitted rather than `aria-disabled="false"`, so the DOM of a live control
    // is the DOM it had before any of this.
    'aria-disabled': isInert || undefined,
    onClick(event) {
      if (isInert) {
        // Matters for `type="submit"`: without this the form still submits.
        event.preventDefault();
        return;
      }
      onClick(event);
    },
  };
}
