import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { hashPassword, WeakPasswordError } from '../src/domain/operator-credentials';
import { PostgresPlatformStore } from '../src/integrations/persistence/postgres-platform-store';
import type { SqlClient } from '../src/integrations/persistence/postgres-run-store';
import { loadEnvLocal } from './load-env';
import { logInfo } from '../src/services/logger';

/**
 * Operator accounts, from a terminal.
 *
 * This is the answer to the bootstrap problem: the first operator cannot be
 * created through the product, because reaching the product requires being an
 * operator. A web setup page that mints an admin for whoever loads it first is
 * the usual answer and a bad one — it is a race with the internet on every
 * fresh deployment. A CLI run against the deployment's own `DATABASE_URL` by
 * someone who already has it is not.
 *
 *   vercel env pull
 *   npm run operator -- add --email sam@example.com --name "Sam Reyes"
 *
 * All the logic lives in `src/domain/operator-credentials.ts` and the store,
 * so nothing here needs a test — and nothing may import this file, because it
 * calls `main()` at import.
 *
 * A password never travels in argv: `ps` shows argv to every process on the
 * box, and shell history keeps it afterwards. It comes from stdin or from
 * `OPERATOR_PASSWORD` in the environment.
 */

function fail(message: string): never {
  console.error(`OPERATOR FAIL: ${message}`);
  process.exit(1);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.OPERATOR_PASSWORD;
  if (fromEnv) return fromEnv;

  if (process.stdin.isTTY) {
    fail(
      'No password supplied. Pipe it in (`… | npm run operator -- add …`) or set OPERATOR_PASSWORD.',
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (!password) fail('Empty password on stdin.');
  return password;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail('DATABASE_URL is not set. Run `vercel env pull` first.');
  }

  const store = new PostgresPlatformStore(neon(databaseUrl) as unknown as SqlClient);
  const command = process.argv[2];

  if (command === 'list') {
    const operators = await store.listOperators();
    for (const operator of operators) {
      const state = operator.disabledAt ? 'disabled' : 'active';
      console.log(`${operator.email}\t${operator.name}\t${state}\t${operator.id}`);
    }
    logInfo('operator_list', { count: operators.length });
    return;
  }

  const email = flag('email');
  if (!email) fail('--email is required.');

  if (command === 'add') {
    const name = flag('name');
    if (!name) fail('--name is required.');

    const password = await readPassword();
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(password);
    } catch (error) {
      if (error instanceof WeakPasswordError) fail(error.message);
      throw error;
    }

    // Upsert is by email, so this both creates and re-enables. An operator who
    // was disabled keeps their id, and therefore keeps their history.
    const existing = await store.getOperatorByEmail(email);
    await store.upsertOperator({
      id: existing?.id ?? `op-${randomUUID()}`,
      email,
      name,
      passwordHash,
    });

    logInfo('operator_upserted', { email, created: !existing });
    return;
  }

  const target = await store.getOperatorByEmail(email);
  if (!target) fail(`No operator with email ${email}.`);

  if (command === 'disable' || command === 'enable') {
    await store.setOperatorDisabled(target.id, command === 'disable');
    logInfo('operator_disabled_changed', { email, disabled: command === 'disable' });
    return;
  }

  if (command === 'revoke-sessions') {
    await store.bumpSessionEpoch(target.id);
    logInfo('operator_sessions_revoked', { email });
    return;
  }

  fail('Usage: operator <add|list|disable|enable|revoke-sessions> [--email …] [--name …]');
}

main().catch((error) => {
  console.error(`OPERATOR FAIL: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
