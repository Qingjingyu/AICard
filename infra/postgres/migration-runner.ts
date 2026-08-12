import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool } from 'pg';

export type MigrationFile = {
  name: string;
  sql: string;
  checksum: string;
};

export async function discoverMigrations(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), 'utf8');
      return {
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

export class MigrationChecksumMismatchError extends Error {
  constructor(name: string) {
    super(`Migration checksum mismatch: ${name}`);
    this.name = 'MigrationChecksumMismatchError';
  }
}

export async function runMigrations(pool: Pool, directory: string): Promise<void> {
  const migrations = await discoverMigrations(directory);
  const client = await pool.connect();
  const advisoryLockId = 2_142_142_201;

  try {
    await client.query('select pg_advisory_lock($1)', [advisoryLockId]);
    await client.query(`
      create table if not exists aicard_schema_migrations (
        name text primary key,
        checksum text not null check (length(checksum) = 64),
        applied_at timestamptz not null default now()
      )
    `);

    const appliedResult = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from aicard_schema_migrations',
    );
    const applied = new Map(appliedResult.rows.map((migration) => [migration.name, migration.checksum]));

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.name);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new MigrationChecksumMismatchError(migration.name);
      }
      if (existingChecksum) continue;

      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into aicard_schema_migrations (name, checksum) values ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [advisoryLockId]).catch(() => undefined);
    client.release();
  }
}
