import type { Page } from 'playwright-core';

import type { PageFacts } from '../../services/page-checks';

/**
 * Reads the facts `services/page-checks` evaluates, and nothing else.
 *
 * This is the browser half of the same seam `axe-scan.ts` holds: the live DOM
 * is read here, PLAIN DATA crosses, and the rules that judge it live in
 * services where the fast suite can reach them. The two halves share the
 * `PageFacts` type so they cannot drift apart silently.
 *
 * ## Why the page code is a string
 *
 * `[V]` Passed as a function, this died inside the page with
 * `ReferenceError: __name is not defined` under `tsx`: esbuild's `keepNames`
 * wraps inner function declarations in a `__name(...)` helper that exists in
 * the Node bundle and not in the browser, and Playwright serializes the
 * function *after* that transform. The same trap axe avoids by injecting
 * `axe.source` — a string — rather than the module (see the
 * `serverExternalPackages` note in `next.config.mjs`). A string is inert to
 * every bundler this project runs under: tsx for the blind test, Next for the
 * deployed app, vitest for the suites.
 */

/**
 * Tags that are interactive on their own. A click handler on one of these is
 * ordinary; on anything else it is a hand-rolled control.
 */
const NATIVE_INTERACTIVE = ['a', 'button', 'input', 'select', 'textarea', 'summary', 'option'];

/**
 * Runs inside the audited page. Plain browser JavaScript, no TypeScript and
 * no outer-scope references — everything it needs arrives as `nativeTags`.
 *
 * Inline `onclick` only, which is a documented boundary rather than an
 * oversight: `addEventListener` handlers are invisible to a DOM read, so a
 * control wired that way is a residual miss — while the inline attribute is
 * exactly the shape a hand-rolled site uses.
 */
const COLLECT = `(nativeTags) => {
  const selectorFor = (element) => {
    if (element.id) return '#' + element.id;
    const parts = [];
    let node = element;
    while (node && node !== document.body && parts.length < 4) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : tag);
      node = parent;
    }
    return parts.join(' > ');
  };

  const truncatedHtml = (element) => element.outerHTML.slice(0, 300);

  const clickTargets = Array.from(document.querySelectorAll('[onclick]'))
    .filter((element) => !nativeTags.includes(element.tagName.toLowerCase()))
    .map((element) => ({
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      tabindex: element.getAttribute('tabindex'),
      html: truncatedHtml(element),
    }));

  const labelledControls = Array.from(
    document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select',
    ),
  ).map((control) => {
    let labelText = null;
    if (control.id) {
      const byFor = document.querySelector('label[for="' + CSS.escape(control.id) + '"]');
      if (byFor && byFor.textContent && byFor.textContent.trim()) labelText = byFor.textContent.trim();
    }
    if (labelText === null) {
      const wrapping = control.closest('label');
      if (wrapping && wrapping.textContent && wrapping.textContent.trim()) labelText = wrapping.textContent.trim();
    }

    return {
      selector: selectorFor(control),
      labelText,
      ariaLabel: control.getAttribute('aria-label'),
      hasAriaLabelledby: control.hasAttribute('aria-labelledby'),
      placeholder: control.getAttribute('placeholder'),
      title: control.getAttribute('title'),
      html: truncatedHtml(control),
    };
  });

  return { clickTargets, labelledControls };
}`;

export async function collectPageFacts(page: Page): Promise<PageFacts> {
  return page.evaluate(
    `(${COLLECT})(${JSON.stringify(NATIVE_INTERACTIVE)})`,
  ) as Promise<PageFacts>;
}
