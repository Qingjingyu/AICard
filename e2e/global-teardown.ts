import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { createPostgresPool } from '../src/server/postgres/pool';

export default async function globalTeardown() {
  if (existsSync('.env.local')) loadEnvFile('.env.local');
  if (!process.env.DATABASE_URL) return;
  const port = process.env.REFERENCE_PRODUCT_E2E_PORT ?? '4281';
  const pool = createPostgresPool(process.env.DATABASE_URL);
  try {
    await pool.query(
      `delete from platform_client_redirect_uris
       where client_id = 'test_client' and redirect_uri = $1`,
      [`http://localhost:${port}/callback`],
    );
  } finally {
    await pool.end();
  }
}
