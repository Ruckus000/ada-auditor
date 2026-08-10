/**
 * Splits a schema file into individual statements.
 *
 * Its own module, not part of `migrate.ts`, because `migrate.ts` calls `main()`
 * at import time. Importing it to reach this one pure function ran the whole
 * migration as a side effect: green locally, where `.env.local` supplies a
 * `DATABASE_URL` — so `npm test` was quietly migrating the real database on
 * every run — and a hard failure in CI, where there is no database and the
 * script calls `process.exit(1)`.
 *
 * Neon's HTTP driver sends one statement per request, so the file cannot be
 * shipped whole. Comments are stripped first so a `;` inside one cannot split
 * a statement in half.
 *
 * Dollar-quoted blocks (`do $$ ... $$`) are held together: they contain their
 * own semicolons, and splitting naively on `;` turns one `do` block into three
 * fragments that are each a syntax error. The schema needs them because
 * `add constraint` has no `if not exists` and has to be guarded by an
 * exception handler to stay idempotent.
 */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .map((line) => (line.trim().startsWith('--') ? '' : line))
    .join('\n');

  const statements: string[] = [];
  let current = '';
  let inDollarBlock = false;

  for (let i = 0; i < withoutComments.length; i += 1) {
    if (withoutComments.startsWith('$$', i)) {
      inDollarBlock = !inDollarBlock;
      current += '$$';
      i += 1;
      continue;
    }

    const char = withoutComments[i];
    if (char === ';' && !inDollarBlock) {
      statements.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  statements.push(current);

  return statements.map((statement) => statement.trim()).filter(Boolean);
}
