import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { loadEnvLocal } from './load-env';
import { splitStatements } from './split-statements';

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
