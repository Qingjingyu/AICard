import { resolve } from 'node:path';

import { runMigrations } from './migration-runner';
import { getServerConfig } from '../../src/server/config';
import { createPostgresPool } from '../../src/server/postgres/pool';

async function main(): Promise<void> {
  const config = getServerConfig();
  const pool = createPostgresPool(config.databaseUrl);

  try {
    await runMigrations(pool, resolve('infra/postgres/migrations'));
    process.stdout.write('AI Card migrations applied successfully.\n');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration failure';
  process.stderr.write(`AI Card migration failed: ${message}\n`);
  process.exitCode = 1;
});
