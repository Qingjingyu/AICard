import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for upgrade-path tests');

const pool = createPostgresPool(databaseUrl);

afterAll(async () => {
  await pool.end();
});

describe('unified account upgrade path', () => {
  it('migrates legacy IDs and dependent references before continuing the sequence', async () => {
    const schema = `upgrade_${randomBytes(6).toString('hex')}`;
    const client = await pool.connect();
    const principalId = '018f4f5d-8f6a-7a13-8e2c-1f21f3489a71';
    const nextPrincipalId = '018f4f5d-8f6a-7a13-8e2c-1f21f3489a72';
    const invitationId = '018f4f5d-8f6a-7a13-8e2c-1f21f3489a73';
    const legacyId = 'aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW';

    try {
      await client.query(`create schema ${schema}`);
      await client.query(`set search_path to ${schema}`);
      for (let index = 1; index <= 8; index += 1) {
        const prefix = String(index).padStart(4, '0');
        const [path] = (await import('node:fs')).readdirSync(resolve('infra/postgres/migrations'))
          .filter((name) => name.startsWith(`${prefix}_`));
        if (!path) throw new Error(`Migration ${prefix} was not found`);
        await client.query(await readFile(resolve('infra/postgres/migrations', path), 'utf8'));
      }
      await client.query(
        'insert into principals (principal_id, principal_type) values ($1, $2)',
        [principalId, 'human'],
      );
      await client.query(
        'insert into ai_cards (card_id, principal_id, display_name) values ($1, $2, $3)',
        [legacyId, principalId, '迁移前用户'],
      );
      await client.query(
        'insert into card_handles (handle, card_id) values ($1, $2)',
        ['legacy_owner', legacyId],
      );
      await client.query(
        `insert into agent_invitations (
           invitation_id, card_id, controller_principal_id, ticket_hash, expires_at
         ) values ($1, $2, $3, $4, now() + interval '1 hour')`,
        [invitationId, legacyId, principalId, randomBytes(32)],
      );

      for (const migration of ['0009_unified_ai_card_ids.sql', '0010_password_accounts.sql']) {
        await client.query(await readFile(resolve('infra/postgres/migrations', migration), 'utf8'));
      }

      expect((await client.query<{ card_id: string }>('select card_id from ai_cards')).rows)
        .toEqual([{ card_id: 'AI_100001' }]);
      expect((await client.query<{ card_id: string }>('select card_id from card_handles')).rows)
        .toEqual([{ card_id: 'AI_100001' }]);
      expect((await client.query<{ card_id: string }>('select card_id from agent_invitations')).rows)
        .toEqual([{ card_id: 'AI_100001' }]);
      expect((await client.query<{ card_id: string }>(
        'select card_id from ai_card_id_aliases where old_card_id = $1',
        [legacyId],
      )).rows).toEqual([{ card_id: 'AI_100001' }]);

      await client.query(
        'insert into principals (principal_id, principal_type) values ($1, $2)',
        [nextPrincipalId, 'human'],
      );
      expect((await client.query<{ card_id: string }>(
        'insert into ai_cards (principal_id, display_name) values ($1, $2) returning card_id',
        [nextPrincipalId, '迁移后用户'],
      )).rows).toEqual([{ card_id: 'AI_100002' }]);
    } finally {
      await client.query('set search_path to public');
      await client.query(`drop schema if exists ${schema} cascade`);
      client.release();
    }
  });
});
