import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { loadEnvLocal } from './load-env';

/**
 * Applies `src/integrations/persistence/schema.sql`.
 *
 * The schema is idempotent (`create table if not exists`, `create index if not
 * exists`), so this is safe to re-run and safe to run against a database that
 * is already current. That is deliberate: a migration tool with a version
 * table is a second thing to keep correct, and this schema is one file.
 *
 * When the schema stops being additive — a column dropped, a type changed —
 * that is the moment to reach for real migrations, not before.
 */

const SCHEMA_PATH = join(process.cwd(), 'src/integrations/persistence/schema.sql');

/**
 * Splits the file into statements.
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

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'MIGRATE FAIL: DATABASE_URL is not set. Run `vercel env pull .env.local --yes`.',
    );
    process.exit(1);
  }

  const sql = neon(url);
  const statements = splitStatements(readFileSync(SCHEMA_PATH, 'utf8'));

  for (const statement of statements) {
    await sql.query(statement);
  }

  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;

  console.log(
    JSON.stringify({
      type: 'migrate',
      statements: statements.length,
      tables: tables.map((row) => row.table_name),
    }),
  );
}

main().catch((error) => {
  console.error(`MIGRATE FAIL: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
