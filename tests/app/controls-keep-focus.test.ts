import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * No control is `disabled` by the work it starts.
 *
 * `disabled` takes an element out of the tab order. When the flag behind it is
 * set by that element's own click or change — "Prepare bundle" becoming busy,
 * a schedule `<select>` saving the value just chosen — the browser takes focus
 * off the control mid-interaction and it falls to `<body>`, and the keyboard
 * user tabs back through the whole workspace to find their place. The markup
 * stays valid and axe passes; `lib/inert-button.ts` records how it was found
 * and why `aria-disabled` plus a guard in the handler is the fix.
 *
 * The rule lived only in that doc comment, so nothing held it: nine controls
 * used it and thirty-odd beside them did not, the delivery panel among them.
 * This is what holds it now.
 *
 * **What it can see.** A JSX `disabled` attribute whose expression names
 * in-flight state — an identifier matching `IN_FLIGHT`, or the literal
 * `'running'` that the run-state unions use. It reads the syntax tree, not the
 * text, so a comment or a line break inside the expression neither hides a
 * site nor invents one.
 *
 * **What it cannot.** A flag with a name outside that list, and a control
 * disabled by state that some other control's click sets. Neither can be read
 * off the source without knowing which handler sets what, and a guard that
 * claimed to would be the kind that reads stronger than it is. A new name for
 * "busy" belongs in `IN_FLIGHT` in the same change that introduces it.
 *
 * Preconditions stay `disabled` and are not this rule's business: a "Describe
 * selected" button with nothing selected was never focused by the act of
 * becoming unavailable.
 */

/**
 * Whole names, optionally `is`-prefixed. Not `pending`: in the workbench that
 * is the list of unsaved answers, a precondition. `isPending` is the in-flight
 * one, from `useTransition`.
 */
const IN_FLIGHT =
  /^(?:(?:is)?(?:busy|loading(?:More)?|saving|submitting|scanning|running|creating|sending|uploading|working|batch)|isPending)$/i;

function inFlightDisabled(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];

  function namesInFlight(node: ts.Node): boolean {
    if (ts.isIdentifier(node) && IN_FLIGHT.test(node.text)) return true;
    if (ts.isStringLiteral(node) && node.text === 'running') return true;
    return ts.forEachChild(node, namesInFlight) ?? false;
  }

  function visit(node: ts.Node): void {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === 'disabled' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      namesInFlight(node.initializer.expression)
    ) {
      const element = node.parent.parent;
      const tag = ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)
        ? element.tagName.getText(tree)
        : '?';
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      offenders.push(`${file}:${line + 1} <${tag}>`);
    }
    ts.forEachChild(node, visit);
  }

  visit(tree);
  return offenders;
}

/**
 * An inert control keeps focus, and the focus ring is a `box-shadow`, so any
 * `opacity` that mutes the control mutes the ring with it. At 0.5 the ring
 * reads about 2.4:1 against the page, under the 3:1 a focus indicator needs
 * (1.4.11). A `disabled` control could never be focused, so the muted style it
 * used to wear never had to answer for this. Inert ones mute by colour.
 */
function mutedByOpacity(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];

  // A property named `opacity`, not the word: a comment explaining why there
  // is no opacity must not count as one.
  function setsOpacity(node: ts.Node): boolean {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      node.name.getText(tree).replace(/['"]/g, '') === 'opacity'
    ) {
      return true;
    }
    return ts.forEachChild(node, setsOpacity) ?? false;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties;
      const inert = attributes.some(
        (attribute) => ts.isJsxSpreadAttribute(attribute) && /^inertWhen\b/.test(attribute.expression.getText(tree)),
      );
      const style = attributes.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'style',
      );
      if (inert && style && setsOpacity(style)) {
        const { line } = tree.getLineAndCharacterOfPosition(style.getStart(tree));
        offenders.push(`${file}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(tree);
  return offenders;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return entry.endsWith('.tsx') ? [path] : [];
  });
}

describe('controls keep focus while they work', () => {
  it('disables no control on in-flight state anywhere under src/app', () => {
    const offenders = tsxFiles(join('src', 'app')).flatMap((file) =>
      inFlightDisabled(file, readFileSync(file, 'utf8')),
    );

    expect(offenders.join('\n')).toBe('');
  });

  it('mutes an inert control by colour, never by opacity, which would fade its focus ring', () => {
    const offenders = tsxFiles(join('src', 'app')).flatMap((file) =>
      mutedByOpacity(file, readFileSync(file, 'utf8')),
    );
    const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8');
    const inertRules = [...css.matchAll(/\[aria-disabled="true"\][^{]*\{([^}]*)\}/g)].map((rule) => rule[1] ?? '');

    expect(offenders.join('\n')).toBe('');
    expect(inertRules.length).toBeGreaterThan(0);
    for (const body of inertRules) expect(body).not.toMatch(/opacity/);
  });

  describe('the detector itself', () => {
    // A guard that has never failed is a guard nobody has tested. These are
    // the shapes the tree had when this was written, kept as fixtures so the
    // detector is proven on every run rather than once by hand.
    it('finds a flag spread over lines, with a comment inside it', () => {
      const source = `const a = <button
        type="button"
        disabled={
          // held while the request runs
          busy || !selected.length
        }
      >x</button>;`;

      expect(inFlightDisabled('planted.tsx', source)).toEqual(['planted.tsx:3 <button>']);
    });

    it('finds the run-state literal and a flag inside a property access', () => {
      expect(inFlightDisabled('a.tsx', `<button disabled={saving || run.state === 'running'} />`)).toHaveLength(1);
      expect(inFlightDisabled('b.tsx', `<select disabled={props.loadingMore} />`)).toHaveLength(1);
    });

    it('finds opacity on an inert control, and not a comment that names it', () => {
      expect(mutedByOpacity('i.tsx', `<button {...inertWhen(busy, go)} style={{ padding: 4, opacity: busy ? 0.6 : 1 }} />`)).toEqual(['i.tsx:1']);
      expect(mutedByOpacity('j.tsx', `<button {...inertWhen(busy, go)} style={{ ...(busy ? { 'opacity': 0.5 } : {}) }} />`)).toHaveLength(1);
      expect(mutedByOpacity('k.tsx', `<button {...inertWhen(busy, go)} style={{ color: T.ink /* not opacity */ }} />`)).toEqual([]);
      expect(mutedByOpacity('l.tsx', `<img style={{ opacity: 0.5 }} />`)).toEqual([]);
    });

    it('matches whole names, not fragments of them', () => {
      // `batchSize` is a number, not a batch in flight; `isPending` is what
      // `useTransition` hands back, and `uploading` is busy by another name.
      expect(inFlightDisabled('f.tsx', `<button disabled={batchSize === 0} />`)).toEqual([]);
      expect(inFlightDisabled('g.tsx', `<button disabled={isPending} />`)).toHaveLength(1);
      expect(inFlightDisabled('h.tsx', `<input disabled={uploading} />`)).toHaveLength(1);
    });

    it('leaves a precondition alone, and a comment that only mentions busy', () => {
      expect(inFlightDisabled('c.tsx', `<button disabled={!openFigures.some((ask) => selected[ask.id])} />`)).toEqual([]);
      expect(inFlightDisabled('d.tsx', `<button disabled={pending.length === 0 /* not busy */} />`)).toEqual([]);
      expect(inFlightDisabled('e.tsx', `<button aria-disabled={busy || undefined} />`)).toEqual([]);
    });
  });
});
