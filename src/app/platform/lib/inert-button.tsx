import type { ButtonHTMLAttributes, MouseEvent } from 'react';

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
 * Enter or Space on a focused button *is* a click. Rendering the attribute and
 * the guard from one component is what stops a call site shipping the claim
 * without the behaviour behind it.
 *
 * A component rather than the prop-spreading helper this used to be. Every call
 * site passes a handler that touches a ref — a cancellation flag, the id of the
 * button to refocus after a move — and handing such a function to a plain
 * function during render is what `react-hooks/refs` refuses, because it cannot
 * see that the handler is only ever called from a click. Passing it as a JSX
 * prop says exactly that, and the invariant above gets stronger on the way
 * past: the attribute and the guard are now impossible to separate, where a
 * spread could be dropped and the `aria-disabled` written by hand.
 *
 * What this does not do is style the control. An inert button that still looks
 * live is its own defect, so every call site pairs this with the muted
 * treatment it already used for `disabled`.
 */
export function InertableButton({
  isInert,
  onClick,
  children,
  ...rest
}: {
  isInert: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'aria-disabled'>) {
  return (
    <button
      type="button"
      {...rest}
      // Omitted rather than `aria-disabled="false"`, so the DOM of a live
      // control is the DOM it had before any of this.
      aria-disabled={isInert || undefined}
      onClick={(event) => {
        if (isInert) {
          // Matters for `type="submit"`: without this the form still submits.
          event.preventDefault();
          return;
        }
        onClick(event);
      }}
    >
      {children}
    </button>
  );
}
