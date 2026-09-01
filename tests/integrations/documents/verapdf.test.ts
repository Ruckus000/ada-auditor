import { describe, expect, it, vi } from 'vitest';

import { checkUa1 } from '../../../src/integrations/documents/verapdf';

/**
 * The wrapper around the reference checker, held to its one honesty rule:
 * every path ends in an answer, and the answer for "nothing was checked" is
 * `checker: 'none'` — which surfaces render as "not checked", never as clean.
 *
 * Driven through the injected executor, so the fast suite never starts a JVM
 * — the same seam every other stage test uses. The real jar is exercised by
 * the corpus runner, which compares the product's verdict against an
 * independent veraPDF run of the same documents.
 */

const runtime = {
  available: true as const,
  javaBin: '/definitely/not/java',
  classpath: 'unused',
  source: 'bundled' as const,
};

function report(compliant: boolean, rules: Array<[string, number, number]> = []) {
  return JSON.stringify({
    report: {
      jobs: [
        {
          validationResult: [
            {
              compliant,
              details: {
                ruleSummaries: rules.map(([clause, testNumber, failedChecks]) => ({
                  clause,
                  testNumber,
                  failedChecks,
                })),
              },
            },
          ],
        },
      ],
    },
  });
}

describe('checkUa1', () => {
  it('reads a compliant document', async () => {
    const result = await checkUa1('/tmp/a.pdf', {
      runtime,
      executor: async () => ({ stdout: report(true) }),
    });
    expect(result).toEqual({ checker: 'verapdf-ua1', compliant: true });
  });

  it('refuses a non-compliance it cannot explain', async () => {
    // `compliant: false` with nothing failing. `withConformance` builds its
    // items from the clause list, so this shape once delivered a document
    // marked NOT CONFORMANT whose punch list said nothing at all about why —
    // a silent gap on the one line a client reads for the answer.
    //
    // "not checked" is the safe direction. A checker that says no and cannot
    // say why knows nothing usable about the document.
    for (const stdout of [report(false, []), report(false, [['7.2', 34, 0]])]) {
      const result = await checkUa1('/tmp/a.pdf', {
        runtime,
        executor: async () => ({ stdout }),
      });
      expect(result).toEqual({ checker: 'none', reason: 'unavailable' });
    }
  });

  it('reads exit 1 as the answer it is — non-compliant, with clauses', async () => {
    // veraPDF exits 1 for a non-compliant file WITH the report on stdout.
    // A wrapper that treated that as a failure would turn every finding into
    // "not checked".
    const error = Object.assign(new Error('exit 1'), {
      code: 1,
      stdout: report(false, [
        ['7.21.4.1', 1, 3],
        ['7.1', 3, 2],
        ['7.2', 34, 0],
      ]),
    });
    const result = await checkUa1('/tmp/a.pdf', {
      runtime,
      executor: async () => {
        throw error;
      },
    });
    // Zero-failure rules are noise, not findings.
    expect(result).toEqual({
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.1-3', '7.21.4.1-1'],
    });
  });

  it('answers "none" for a crashed checker — it knows nothing about the document', async () => {
    const error = Object.assign(new Error('boom'), { code: 7, stdout: '' });
    const result = await checkUa1('/tmp/a.pdf', {
      runtime,
      executor: async () => {
        throw error;
      },
    });
    expect(result).toEqual({ checker: 'none', reason: 'unavailable' });
  });

  it('answers "none" for unparseable output rather than guessing', async () => {
    const result = await checkUa1('/tmp/a.pdf', {
      runtime,
      executor: async () => ({ stdout: 'not json at all' }),
    });
    expect(result).toEqual({ checker: 'none', reason: 'unavailable' });
  });

  it('answers "none" with no JVM, spending nothing', async () => {
    const executor = vi.fn();
    const result = await checkUa1('/tmp/a.pdf', {
      runtime: { available: false, reason: 'no JVM anywhere' },
      executor,
    });
    expect(result).toEqual({ checker: 'none', reason: 'unavailable' });
    expect(executor).not.toHaveBeenCalled();
  });
});
