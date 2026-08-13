import { expect, it } from 'vitest';

import { readDatabaseSnapshot } from '../../scripts/production-doctor.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for production doctor tests');

it('reads the authoritative migration and product-client ledgers', async () => {
  const snapshot = await readDatabaseSnapshot(databaseUrl);

  expect(snapshot.migrations).toContain('0013_aicard_web_registration_client.sql');
  expect(snapshot.clients).toContainEqual(expect.objectContaining({ clientId: 'yoyoo_dev' }));
});
