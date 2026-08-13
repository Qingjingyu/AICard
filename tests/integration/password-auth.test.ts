import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import { AuthenticationStateError, AuthenticationVerificationError } from '@/server/authentication/errors';
import { PasswordAuthenticationService } from '@/server/authentication/password-authentication-service';
import { PostgresAuthenticationRepository } from '@/server/postgres/authentication-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for password authentication tests');

const pool = createPostgresPool(databaseUrl);
const repository = new PostgresAuthenticationRepository(pool);
const service = new PasswordAuthenticationService(repository);

const registration = {
  clientId: 'test_client',
  idempotencyKey: 'register-test-key-0000000000000001',
  displayName: '  苏白  ',
  handle: 'subai_account',
  password: 'correct horse 电池 staple',
  requestId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a31',
};

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

beforeEach(async () => {
  await pool.query('delete from security_audit_events');
  await pool.query('delete from principals');
  await pool.query('delete from auth_rate_limits');
  await pool.query("select setval('ai_card_public_id_sequence', 100001, false)");
});

afterAll(async () => {
  await pool.end();
});

describe('password account service', () => {
  it('creates one Card, a non-plaintext credential, an audit event, and a session atomically', async () => {
    const result = await service.register(registration);

    expect(result.replayed).toBe(false);
    expect(result.card).toMatchObject({
      cardId: 'AI_100001',
      displayName: '苏白',
      handle: 'subai_account',
    });
    expect(await service.resolveSession(result.sessionToken)).toMatchObject({
      principalId: result.card.principalId,
    });
    const credential = await pool.query<{
      password_hash: Buffer;
      password_salt: Buffer;
      password_algorithm: string;
    }>('select password_hash, password_salt, password_algorithm from human_password_credentials');
    expect(credential.rows[0]).toMatchObject({ password_algorithm: 'scrypt-v1' });
    expect(credential.rows[0]?.password_hash.toString('utf8')).not.toContain(registration.password);
    expect(credential.rows[0]?.password_salt.toString('utf8')).not.toContain(registration.password);
    const audit = await pool.query<{ event_type: string }>(
      "select event_type from security_audit_events where event_type = 'password.registered'",
    );
    expect(audit.rows).toEqual([{ event_type: 'password.registered' }]);
  });

  it('returns the same identity for an identical idempotent retry without issuing another Card', async () => {
    const first = await service.register(registration);
    const replay = await service.register(registration);

    expect(replay.replayed).toBe(true);
    expect(replay.card.principalId).toBe(first.card.principalId);
    expect(replay.card.cardId).toBe(first.card.cardId);
    expect(replay.sessionToken).not.toBe(first.sessionToken);
    expect((await pool.query('select 1 from ai_cards')).rowCount).toBe(1);
  });

  it('requires the original password before an idempotent retry can restore a session', async () => {
    await service.register(registration);

    await expect(service.register({ ...registration, password: 'different secure passphrase' }))
      .rejects.toMatchObject({
        name: AuthenticationVerificationError.name,
        message: 'Account or password is invalid',
      });
    expect((await pool.query('select 1 from auth_sessions')).rowCount).toBe(1);
    expect((await pool.query('select 1 from ai_cards')).rowCount).toBe(1);
  });

  it('rejects reuse of an idempotency key with changed content without creating another identity', async () => {
    await service.register(registration);

    await expect(service.register({ ...registration, displayName: '另一个人' }))
      .rejects.toBeInstanceOf(AuthenticationStateError);
    expect((await pool.query('select 1 from ai_cards')).rowCount).toBe(1);
  });

  it('logs in by Card ID or handle and returns one generic error for unknown and incorrect credentials', async () => {
    const registered = await service.register(registration);
    const byCard = await service.login({
      identifier: registered.card.cardId,
      password: registration.password,
      requestId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a32',
    });
    const byHandle = await service.login({
      identifier: '@SUBAI_ACCOUNT',
      password: registration.password,
      requestId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a33',
    });

    expect(byCard.card.cardId).toBe(registered.card.cardId);
    expect(byHandle.card.cardId).toBe(registered.card.cardId);
    const wrong = service.login({ identifier: registered.card.cardId, password: 'wrong' });
    const unknown = service.login({ identifier: 'AI_999999', password: 'wrong' });
    await expect(wrong).rejects.toMatchObject({
      name: AuthenticationVerificationError.name,
      message: 'Account or password is invalid',
    });
    await expect(unknown).rejects.toMatchObject({
      name: AuthenticationVerificationError.name,
      message: 'Account or password is invalid',
    });
  });
});
