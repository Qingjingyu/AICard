import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { createPostgresPool } from '../src/server/postgres/pool';

export default async function globalSetup() {
  if (existsSync('.env.local')) loadEnvFile('.env.local');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for AI Card E2E setup');
  }
  const port = process.env.REFERENCE_PRODUCT_E2E_PORT ?? '4281';
  const pool = createPostgresPool(process.env.DATABASE_URL);
  try {
    await pool.query(
      `insert into platform_client_redirect_uris (client_id, redirect_uri)
       values ('test_client', $1)
       on conflict do nothing`,
      [`http://localhost:${port}/callback`],
    );
  } finally {
    await pool.end();
  }
}
