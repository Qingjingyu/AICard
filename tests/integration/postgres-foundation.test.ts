import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import { checkPostgres, createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
}

const pool = createPostgresPool(databaseUrl);
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  await pool.end();
});

describe('PostgreSQL foundation', () => {
  it('reports a live database connection after migrations', async () => {
    const health = await checkPostgres(pool);

    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    const metadata = await pool.query<{ value: string }>(
      "select value from service_metadata where key = 'foundation_version'",
    );
    expect(metadata.rows).toEqual([{ value: '1' }]);
  });

  it('records an immutable checksum for each migration', async () => {
    const result = await pool.query<{ name: string; checksum: string }>(
      'select name, checksum from aicard_schema_migrations order by name',
    );

    expect(result.rows.map(({ name }) => name)).toEqual([
      '0001_foundation.sql',
      '0002_identity_core.sql',
      '0003_human_credentials.sql',
      '0004_agent_enrollment.sql',
      '0005_platform_authorization.sql',
      '0006_platform_token_subject_binding.sql',
      '0007_refresh_grants_and_revocation.sql',
      '0008_agent_runtime_sessions.sql',
    ]);
    for (const migration of result.rows) {
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('rejects a changed checksum for an applied migration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aicard-drift-'));
    temporaryDirectories.push(directory);
    const migrationPath = join(directory, '9001_drift_guard.sql');
    await writeFile(migrationPath, 'create table drift_guard (id integer primary key);\n');
    await runMigrations(pool, directory);
    await writeFile(migrationPath, 'create table drift_guard_changed (id integer primary key);\n');

    await expect(runMigrations(pool, directory)).rejects.toThrow(/checksum mismatch/i);
  });
});
