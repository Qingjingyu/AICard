import { performance } from 'node:perf_hooks';

import { Pool } from 'pg';

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    application_name: 'ai-card',
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
}

export async function checkPostgres(pool: Pool): Promise<{ latencyMs: number }> {
  const startedAt = performance.now();
  await pool.query('select 1');

  return { latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
}
