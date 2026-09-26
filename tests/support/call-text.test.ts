/**
 * The scanner behind `jvm-invocations-are-headless.test.ts`, under test.
 *
 * A guard is only as trustworthy as the window it judges, and this module is
 * that window. `browser-routes-are-packaged.test.ts` sets the precedent: it
 * unit-tests its own resolver against synthetic input, because "a resolver
 * that quietly stopped resolving would report every route as browser-free and
 * this whole file would pass by finding nothing." Same risk here, so the same
 * answer — the two cases named DEFECT below are the ones that used to pass
 * silently, and they are the reason this file exists.
 */
import { describe, expect, it } from 'vitest';

import { argvArray, callText } from './call-text';

/** The argv array of the first spawn-shaped call in `src`. */
function argvOf(src: string): string | null {
  const spawn = /\b(?:execFileSync|execFileAsync|execFile|spawnSync|spawn|execute|run)\s*\(/;
  const match = spawn.exec(src);
  if (match === null) throw new Error('the fixture has no call in it');
  const call = callText(src, match.index + match[0].length - 1);
  return call === null ? null : argvArray(call);
}

describe('callText', () => {
  it('ends at the call\'s own closing paren, not the first one it meets', () => {
    const src = `execFileSync(JAVA, ['-cp', join(a, b)], { maxBuffer: 1 });\nafter();`;
    expect(callText(src, 'execFileSync'.length)).toBe(
      `(JAVA, ['-cp', join(a, b)], { maxBuffer: 1 })`,
    );
  });

  it('is not fooled by a paren inside a message string', () => {
    // `prepare-jvm.ts` names its step in the first argument, and a step named
    // "... (v2)" would close the call early for a naive depth count.
    const src = `run('the runtime does not run (v2', javaBin, ['-version']);`;
    expect(callText(src, 'run'.length)).toBe(
      `('the runtime does not run (v2', javaBin, ['-version'])`,
    );
  });

  it('is not fooled by a paren inside a comment between arguments', () => {
    const src = `execFile(\n  JAVA, // the jdk (resolved\n  ['-version'],\n);`;
    // The comment comes back blanked, same length, so offsets still line up
    // with the source it was read from.
    expect(callText(src, 'execFile'.length)).toBe(
      `(\n  JAVA, ${' '.repeat('// the jdk (resolved'.length)}\n  ['-version'],\n)`,
    );
  });

  it('returns null when the call never closes, rather than guessing an end', () => {
    expect(callText(`execFileSync(JAVA, ['-cp', CP`, 'execFileSync'.length)).toBeNull();
  });

  it('returns null on an unterminated block comment', () => {
    expect(callText(`execFileSync(JAVA, /* why\n['-Dx']);`, 'execFileSync'.length)).toBeNull();
  });

  it('returns null rather than a window wide enough to contain anything', () => {
    // A scan derailed by something it cannot lex must not run for pages and
    // then close on an unrelated `)`. `[V]` The longest real call is 458 chars.
    const src = `execFileSync(JAVA, '${'x'.repeat(5000)}')`;
    expect(callText(src, 'execFileSync'.length)).toBeNull();
  });

  it('blanks comments so their text cannot vouch for the code', () => {
    // `[V]` scripts/doc-blind-test/run.ts:313 explains its flag in a comment
    // that quotes it verbatim, one line above the array that carries it.
    const src = `execFile(JAVA, /* -Djava.awt.headless=true */ ['-cp', CP]);`;
    const call = callText(src, 'execFile'.length);
    expect(call).not.toContain('java.awt.headless');
    expect(call).toContain(`['-cp', CP]`);
  });

  it('keeps string contents, which are arguments rather than prose', () => {
    const src = `execFile(JAVA, ['-Djava.awt.headless=true']);`;
    expect(callText(src, 'execFile'.length)).toContain('java.awt.headless');
  });
});

describe('argvArray', () => {
  it('finds a plain argument array', () => {
    expect(argvOf(`execFileSync(JAVA, ['-Djava.awt.headless=true', '-cp', CP], {});`))
      .toBe(`['-Djava.awt.headless=true', '-cp', CP]`);
  });

  it('keeps a nested array whole, where the first `]` used to truncate', () => {
    expect(argvOf(`execFileSync(JAVA, ['-cp', ['a', 'b'].join(':'), '-Dx'], {});`))
      .toBe(`['-cp', ['a', 'b'].join(':'), '-Dx']`);
  });

  it('ignores a bracket inside a string argument', () => {
    expect(argvOf(`execFileSync(JAVA, ['-Dx=a]b', '-Dy'], {});`)).toBe(`['-Dx=a]b', '-Dy']`);
  });

  it('ignores brackets inside a template substitution', () => {
    expect(argvOf('execFileSync(JAVA, [`-cp`, `${dirs[0]}:${jar}`], {});'))
      .toBe('[`-cp`, `${dirs[0]}:${jar}`]');
  });

  it('survives an object literal inside a template substitution', () => {
    // `[V]` A first version popped the template on the object's `}` and lost
    // the rest of the call, reporting a readable site as unreadable.
    expect(argvOf('execFileSync(JAVA, [`${fmt({ a: 1 })}`, HEADLESS], {});'))
      .toBe('[`${fmt({ a: 1 })}`, HEADLESS]');
  });

  it('survives a nested template literal', () => {
    expect(argvOf("execFileSync(JAVA, [`${a ? `${b}` : ''}`, HEADLESS], {});"))
      .toBe("[`${a ? `${b}` : ''}`, HEADLESS]");
  });

  it('does not read `//` inside a string as a comment', () => {
    expect(argvOf(`execFileSync(JAVA, ['-Durl=https://example.test', HEADLESS]);`))
      .toBe(`['-Durl=https://example.test', HEADLESS]`);
  });

  it('does not desync on an escaped quote', () => {
    expect(argvOf(`execFileSync(JAVA, ['it\\'s', HEADLESS]);`))
      .toBe(`['it\\'s', HEADLESS]`);
  });

  it('is unaffected by an index expression in binary position', () => {
    // The most likely false red the argument-position rule could introduce.
    expect(argvOf(`execFileSync(bins[0], ['-Dx', HEADLESS], {});`)).toBe(`['-Dx', HEADLESS]`);
  });

  it('does not mistake an index expression for the argument array', () => {
    // `paths[0]` is at argument depth too; only a `[` that follows `(` or `,`
    // starts an array literal.
    expect(argvOf(`execFileSync(JAVA, ['-cp', paths[0], '-Dx'], {});`))
      .toBe(`['-cp', paths[0], '-Dx']`);
  });

  it('finds the array across lines with comments between the arguments', () => {
    // `[V]` The shape that broke a first version of this function, and the
    // shape `stage.ts` and the multi-line spike runners actually use.
    const src = `execFileSync(\n  JAVA, // the jdk\n  [\n    '-Dx', // why\n    '-cp', CP,\n  ],\n  { maxBuffer: 1 },\n);`;
    expect(argvOf(src)).toBe(`[\n    '-Dx', ${' '.repeat('// why'.length)}\n    '-cp', CP,\n  ]`);
  });

  it('finds the array when it is the last argument', () => {
    expect(argvOf(`spawn(JAVA, ['-Dx']);`)).toBe(`['-Dx']`);
  });

  it('ignores an array inside an options object', () => {
    // Only a call's own argument counts. An options object is not the command
    // line, which is the whole point of reading the argv and nothing else.
    expect(argvOf(`execFileSync(JAVA, args, { env: { X: ['-Dx'] } });`)).toBeNull();
  });

  it('is unaffected by a callback argument', () => {
    expect(argvOf(`execFile(JAVA, ['-Dx'], (e, o) => { if (e) throw e; });`)).toBe(`['-Dx']`);
  });

  it('DEFECT: a hoisted args variable yields null, not a later unrelated array', () => {
    // The silent pass this module was written to remove. The old
    // `indexOf('[')` ran past the call and found `NOTES`, whose contents then
    // vouched for a spawn that carries no flag at all.
    const src = [
      `const args = ['-cp', 'x', 'Inspect'];`,
      `execFileSync(JAVA, args, { maxBuffer: 1 });`,
      `const NOTES = ['-Djava.awt.headless=true is set elsewhere'];`,
    ].join('\n');
    expect(argvOf(src)).toBeNull();
  });

  it('DEFECT: a hoisted args variable yields null when no array follows at all', () => {
    // The other half: the old code hit `open === -1` and skipped the site
    // entirely, while the population floor went on counting it.
    expect(argvOf(`const args = ['-cp', 'x'];\nexport const go = () => execFileSync(JAVA, args);`))
      .toBeNull();
  });
});
