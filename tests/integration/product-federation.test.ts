import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import { hashOpaqueToken } from '@/server/authentication/auth-security';
import { IdentityService } from '@/server/identity-service';
import { PlatformAuthorizationService } from '@/server/authorization/authorization-service';
import {
  ProductFederationError,
  ProductFederationService,
} from '@/server/federation/product-federation-service';
import { InProcessProductIdentityGateway } from '@/server/federation/product-identity-gateway';
import { PostgresIdentityRepository } from '@/server/postgres/identity-repository';
import { PostgresPlatformAuthorizationRepository } from '@/server/postgres/platform-authorization-repository';
import { PostgresProductFederationRepository } from '@/server/postgres/product-federation-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for product federation tests');

const pool = createPostgresPool(databaseUrl);
const authorization = new PlatformAuthorizationService(
  new PostgresPlatformAuthorizationRepository(pool),
);
const federationRepository = new PostgresProductFederationRepository(pool);
const federation = new ProductFederationService(
  new InProcessProductIdentityGateway(authorization),
  federationRepository,
  'http://localhost:3000',
);
const identities = new IdentityService(new PostgresIdentityRepository(pool));

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

beforeEach(async () => {
  await pool.query('delete from reference_product.sessions');
  await pool.query('delete from reference_product.members');
  await pool.query('delete from reference_product.login_flows');
  await pool.query('delete from principals');
  await pool.query('delete from security_audit_events');
});

afterAll(async () => {
  await pool.end();
});

async function createHolder() {
  return identities.createCard({
    principalType: 'human',
    displayName: '联邦测试用户',
    handle: `federation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  });
}

async function completeForClient(input: {
  holderPrincipalId: string;
  clientId: 'yoyoo_dev' | 'test_client';
  redirectUri: string;
}) {
  const flow = await federation.begin({
    clientId: input.clientId,
    redirectUri: input.redirectUri,
  });
  const approved = await authorization.resolveConsent({
    principalId: input.holderPrincipalId,
    decision: 'approve',
    request: flow.request,
  });
  return federation.complete({
    flow,
    code: approved.code!,
    returnedState: flow.state,
  });
}

describe('reference product federation adapter', () => {
  it('keeps the reference product schema free of foreign keys into AI Card tables', async () => {
    const constraints = await pool.query<{ target_schema: string }>(
      `select target_namespace.nspname as target_schema
       from pg_constraint constraint_record
       join pg_class source_table on source_table.oid = constraint_record.conrelid
       join pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
       join pg_class target_table on target_table.oid = constraint_record.confrelid
       join pg_namespace target_namespace on target_namespace.oid = target_table.relnamespace
       where constraint_record.contype = 'f'
         and source_namespace.nspname = 'reference_product'`,
    );

    expect(constraints.rows.map((row) => row.target_schema)).toEqual(['reference_product']);
  });

  it('reuses one AI Card across two products while keeping pairwise subjects separate', async () => {
    const holder = await createHolder();
    const yoyoo = await completeForClient({
      holderPrincipalId: holder.principalId,
      clientId: 'yoyoo_dev',
      redirectUri: 'http://localhost:4173/auth/aicard/callback',
    });
    const testProduct = await completeForClient({
      holderPrincipalId: holder.principalId,
      clientId: 'test_client',
      redirectUri: 'http://localhost:4174/callback',
    });

    expect(yoyoo.member.cardId).toBe(holder.cardId);
    expect(testProduct.member.cardId).toBe(holder.cardId);
    expect(yoyoo.member.subject).not.toBe(testProduct.member.subject);
    expect((await pool.query('select card_id from ai_cards')).rows).toEqual([{ card_id: holder.cardId }]);
    expect((await pool.query(
      'select client_id, card_id from reference_product.members order by client_id',
    )).rows).toEqual([
      { client_id: 'test_client', card_id: holder.cardId },
      { client_id: 'yoyoo_dev', card_id: holder.cardId },
    ]);
    await expect(federation.resolveSession(yoyoo.sessionToken)).resolves.toMatchObject({
      clientId: 'yoyoo_dev',
      cardId: holder.cardId,
    });
  });

  it('rejects a callback with mismatched state before exchanging or writing product identity', async () => {
    const flow = await federation.begin({
      clientId: 'test_client',
      redirectUri: 'http://localhost:4174/callback',
    });

    await expect(federation.complete({
      flow,
      code: `ac_${'a'.repeat(43)}`,
      returnedState: `${flow.state}tampered`,
    })).rejects.toBeInstanceOf(ProductFederationError);
    expect((await pool.query('select member_id from reference_product.members')).rowCount).toBe(0);
    expect((await pool.query('select session_hash from reference_product.sessions')).rowCount).toBe(0);
  });

  it('does not create a local fallback identity when AI Card exchange fails', async () => {
    const flow = await federation.begin({
      clientId: 'test_client',
      redirectUri: 'http://localhost:4174/callback',
    });

    await expect(federation.complete({
      flow,
      code: `ac_${'z'.repeat(43)}`,
      returnedState: flow.state,
    })).rejects.toBeTruthy();
    expect((await pool.query('select member_id from reference_product.members')).rowCount).toBe(0);
  });

  it('recovers the same member and session after an unknown callback result', async () => {
    const holder = await createHolder();
    const flow = await federation.begin({
      clientId: 'test_client',
      redirectUri: 'http://localhost:4174/callback',
    });
    const approved = await authorization.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: flow.request,
    });
    const callback = {
      flow,
      code: approved.code!,
      returnedState: flow.state,
    };

    const first = await federation.complete(callback);
    const recovered = await federation.complete(callback);

    expect(recovered).toEqual(first);
    expect((await pool.query('select member_id from reference_product.members')).rowCount).toBe(1);
    expect((await pool.query('select session_hash from reference_product.sessions')).rowCount).toBe(1);
  });

  it('does not store the PKCE verifier in plaintext', async () => {
    const flow = await federation.begin({
      clientId: 'test_client',
      redirectUri: 'http://localhost:4174/callback',
    });
    const columns = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'reference_product' and table_name = 'login_flows'`,
    );
    const stored = await pool.query<{ verifier_ciphertext: Buffer }>(
      'select verifier_ciphertext from reference_product.login_flows where flow_hash = $1',
      [hashOpaqueToken(flow.flowToken)],
    );

    expect(columns.rows.map((row) => row.column_name)).not.toContain('code_verifier');
    expect(stored.rows[0]?.verifier_ciphertext.toString('utf8')).not.toContain('verifier');
  });
});
