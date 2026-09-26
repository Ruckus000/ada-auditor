/**
 * Slicing one call out of source text, for the guards that read the tree.
 *
 * WHY THIS EXISTS RATHER THAN AN `indexOf`
 *
 * `jvm-invocations-are-headless.test.ts` used to find a call's argument array
 * with `src.indexOf('[', match.index)` — unbounded, so for a call that passes
 * a hoisted variable instead of a literal (`execFileSync(JAVA, args, {…})`)
 * the search ran past the call and landed on an unrelated array further down
 * the file. `[V]` If that array happened to carry the flag, the guard vouched
 * for a spawn that did not have it, and every case stayed green. Its partner
 * `src.indexOf(']', open)` took the *first* close bracket, so a nested array
 * truncated the window early.
 *
 * Both are the same mistake: a window chosen by the next matching character
 * rather than by the structure of the call.
 *
 * WHY COMMENTS COME OUT
 *
 * `[V]` `scripts/doc-blind-test/run.ts:313` explains its own flag in a comment
 * that quotes `-Djava.awt.headless=true` verbatim, one line above the array
 * that carries it. Text like that must never be able to vouch for code, so
 * every span this scanner classifies as a comment is blanked to spaces in what
 * these functions return. String contents are kept — a flag inside a string
 * literal *is* the argument.
 *
 * WHAT THIS SCANNER CANNOT SEE
 *
 * It is a scanner, not a parser. It tracks strings, template substitutions
 * (including nested templates and object literals inside them) and comments,
 * which is what real calls in this repo contain. It does **not** lex regular
 * expression literals, because telling `/` as a regex from `/` as division
 * needs token-level context. A regex holding an unbalanced quote, paren or
 * bracket would derail the scan — but a derailed scan runs to the cap or to
 * the end of the file and returns `null`, which its callers report as an
 * offender. It fails loud. No call site in the tree contains a regex literal.
 *
 * Do not add heuristic regex detection: a heuristic that guesses wrong fails
 * *silently* in the green direction, which is the class of defect this module
 * was written to remove.
 */

/** How far a single call may run before the scan is treated as derailed. */
const LONGEST_CALL = 4_000;

type Kind = 'code' | 'string' | 'comment';

/**
 * Every character of `src` from `from`, each labelled with what it is part of.
 *
 * One pass, one mode stack, because the three consumers below must agree
 * exactly on where a string ends and a comment begins. Template literals are
 * the awkward case: a `${…}` substitution is real code that may contain
 * braces, quotes and further templates, so the stack records how deep inside
 * ordinary braces the substitution has gone — `${fmt({ a: 1 })}` must not end
 * at the object literal's `}`.
 */
function* scan(src: string, from: number): Generator<[number, string, Kind]> {
  // One frame per template literal we are inside a substitution of.
  const templates: { braces: number }[] = [];
  let quote: string | null = null;

  for (let i = from; i < src.length; i += 1) {
    const c = src[i];

    if (quote !== null) {
      if (c === '\\') {
        yield [i, c, 'string'];
        if (i + 1 < src.length) yield [i + 1, src[i + 1], 'string'];
        i += 1;
        continue;
      }
      if (quote === '`' && c === '$' && src[i + 1] === '{') {
        templates.push({ braces: 0 });
        quote = null;
        yield [i, c, 'string'];
        yield [i + 1, src[i + 1], 'string'];
        i += 1;
        continue;
      }
      yield [i, c, 'string'];
      if (c === quote) quote = null;
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      const newline = src.indexOf('\n', i);
      const end = newline === -1 ? src.length : newline;
      for (let j = i; j < end; j += 1) yield [j, src[j], 'comment'];
      i = end - 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close === -1) return; // unterminated: the rest cannot be read
      for (let j = i; j <= close + 1; j += 1) yield [j, src[j], 'comment'];
      i = close + 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      yield [i, c, 'string'];
      continue;
    }

    const template = templates.at(-1);
    if (template !== undefined) {
      if (c === '{') template.braces += 1;
      else if (c === '}') {
        if (template.braces === 0) {
          templates.pop();
          quote = '`';
          yield [i, c, 'string'];
          continue;
        }
        template.braces -= 1;
      }
    }

    yield [i, c, 'code'];
  }
}

/**
 * The text of the call whose opening `(` sits at `openParen`, brackets
 * included and comments blanked — or `null` when the call cannot be read.
 *
 * `null` is a real answer, not an error case. A caller that treats it as
 * "nothing to check here" reintroduces exactly the silent pass this module
 * exists to remove; it means "this could not be read", and the guards report
 * it as an offender.
 *
 * The cap matters for the same reason. Without it a scan derailed by an
 * unlexed regex could run for pages, find some unrelated `)`, and hand back a
 * window wide enough to contain almost anything — a silent pass by accident.
 * `[V]` The longest real call in the tree is 458 characters.
 */
export function callText(src: string, openParen: number): string | null {
  const out: string[] = [];
  let depth = 0;

  for (const [i, c, kind] of scan(src, openParen)) {
    if (i - openParen >= LONGEST_CALL) return null;
    out.push(kind === 'comment' ? ' ' : c);

    if (kind !== 'code') continue;
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return out.join('');
    }
  }

  return null;
}

/**
 * The array literal passed as one of a call's arguments, or `null` when it
 * passes none — `execFileSync(JAVA, args)` with `args` declared elsewhere.
 *
 * Takes what `callText` returned, so comments are already blank.
 *
 * "Passed as an argument" is the whole distinction, and it is what keeps
 * `paths[0]` in `execFileSync(JAVA, ['-cp', paths[0], …])` from being read as
 * the argument array: an argument sits at the call's own paren depth, outside
 * any object literal, and directly follows `(` or `,`.
 *
 * That preceding character is compared against the last one the **scanner**
 * saw, not the last one in the raw text. `[V]` A first version compared raw
 * text and missed the array in every call with a comment between its
 * arguments — the shape `stage.ts` and `doc-blind-test/run.ts` both use.
 */
export function argvArray(call: string): string | null {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let start = -1;
  let previous = '';

  for (const [i, c, kind] of scan(call, 0)) {
    if (kind !== 'code') continue;

    if (start !== -1) {
      if (c === '[') bracket += 1;
      else if (c === ']') {
        bracket -= 1;
        if (bracket === 0) return call.slice(start, i + 1);
      }
      continue;
    }

    if (/\s/.test(c)) continue;

    if (c === '(') paren += 1;
    else if (c === ')') paren -= 1;
    else if (c === '{') brace += 1;
    else if (c === '}') brace -= 1;
    else if (c === '[' && paren === 1 && brace === 0 && (previous === '(' || previous === ',')) {
      start = i;
      bracket = 1;
      continue;
    }

    previous = c;
  }

  return null;
}
