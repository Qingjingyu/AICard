import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import {
  PlatformClientRegistrationConflictError,
  PlatformClientRegistrationService,
} from '@/server/authorization/platform-client-registration-service';
import { PostgresPlatformClientRepository } from '@/server/postgres/platform-client-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for client registration tests');

const pool = createPostgresPool(databaseUrl);
const service = new PlatformClientRegistrationService(new PostgresPlatformClientRepository(pool));

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

afterAll(async () => {
  await pool.query("delete from platform_clients where client_id like 'product_test_%'");
  await pool.end();
});

function input(suffix: string) {
  return {
    clientId: `product_test_${suffix}`,
    displayName: `Product ${suffix}`,
    audience: `product:${suffix}`,
    redirectUris: [`https://${suffix}.yoyooai.com/auth/aicard/callback`],
    scopes: ['card.basic', 'card.handle', 'card.id', 'offline_access'],
  } as const;
}

describe('operator-controlled platform client registration', () => {
  it('creates one exact client and safely recovers the same request', async () => {
    const registration = input('alpha');

    await expect(service.register(registration)).resolves.toMatchObject({ created: true });
    await expect(service.register(registration)).resolves.toMatchObject({ created: false });

    const stored = await pool.query(
      `select clients.client_id, clients.audience,
              array_agg(distinct redirects.redirect_uri order by redirects.redirect_uri) as redirects,
              array_agg(distinct scopes.scope order by scopes.scope) as scopes
       from platform_clients clients
       join platform_client_redirect_uris redirects using (client_id)
       join platform_client_scopes scopes using (client_id)
       where clients.client_id = $1
       group by clients.client_id, clients.audience`,
      [registration.clientId],
    );
    expect(stored.rows).toEqual([expect.objectContaining({
      client_id: registration.clientId,
      audience: registration.audience,
      redirects: [...registration.redirectUris],
      scopes: [...registration.scopes].sort(),
    })]);
    expect((await pool.query(
      `select event_type, target_id, result from security_audit_events
       where event_type = 'platform.client.registered' and target_id = $1`,
      [registration.clientId],
    )).rows).toEqual([{
      event_type: 'platform.client.registered',
      target_id: registration.clientId,
      result: 'succeeded',
    }]);
  });

  it('rejects configuration drift instead of silently expanding access', async () => {
    const registration = input('conflict');
    await service.register(registration);

    await expect(service.register({
      ...registration,
      redirectUris: ['https://attacker.example/callback'],
    })).rejects.toBeInstanceOf(PlatformClientRegistrationConflictError);
    await expect(service.register({
      ...registration,
      scopes: [...registration.scopes, 'agent.runtime'],
    })).rejects.toBeInstanceOf(PlatformClientRegistrationConflictError);
  });

  it('requires HTTPS except for an explicitly enabled localhost development callback', async () => {
    await expect(service.register({
      ...input('insecure'),
      redirectUris: ['http://product.yoyooai.com/callback'],
    })).rejects.toThrow(/HTTPS/);

    const local = {
      ...input('local'),
      redirectUris: ['http://localhost:4999/callback'],
    };
    await expect(service.register(local)).rejects.toThrow(/HTTPS/);
    await expect(service.register(local, { allowInsecureLocalhost: true }))
      .resolves.toMatchObject({ created: true });
  });

  it('allows separate clients to target the same resource audience', async () => {
    const first = { ...input('shared_a'), audience: 'shared-resource' };
    const second = { ...input('shared_b'), audience: 'shared-resource' };

    await expect(service.register(first)).resolves.toMatchObject({ created: true });
    await expect(service.register(second)).resolves.toMatchObject({ created: true });
  });
});
