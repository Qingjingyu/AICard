import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import { createPrincipalId } from '@/domain/identity/ids';
import { hashOpaqueToken } from '@/server/authentication/auth-security';
import { PostgresAuthenticationRepository } from '@/server/postgres/authentication-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for authentication tests');

const pool = createPostgresPool(databaseUrl);
const repository = new PostgresAuthenticationRepository(pool);

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

beforeEach(async () => {
  await pool.query('delete from security_audit_events');
  await pool.query('delete from principals');
  await pool.query('delete from auth_challenges');
  await pool.query('delete from auth_rate_limits');
});

afterAll(async () => {
  await pool.end();
});

async function createPrincipal(): Promise<string> {
  const principalId = createPrincipalId();
  await pool.query(
    'insert into principals (principal_id, principal_type) values ($1, $2)',
    [principalId, 'human'],
  );
  return principalId;
}

describe('PostgreSQL authentication repository', () => {
  it('consumes an unexpired challenge exactly once', async () => {
    const issued = await repository.issueChallenge({
      purpose: 'authentication',
      challengeHash: hashOpaqueToken('challenge-value'),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await repository.consumeChallenge(issued.challengeId, 'authentication');
    const replay = await repository.consumeChallenge(issued.challengeId, 'authentication');

    expect(first?.challengeHash).toEqual(hashOpaqueToken('challenge-value'));
    expect(replay).toBeNull();
  });

  it('refuses expired challenges', async () => {
    const issued = await repository.issueChallenge({
      purpose: 'registration',
      challengeHash: hashOpaqueToken('expired-value'),
      expiresAt: new Date(Date.now() - 1_000),
      pendingDisplayName: '苏白',
      pendingHandle: 'subai_test',
      webauthnUserId: 'user_test',
    });

    expect(await repository.consumeChallenge(issued.challengeId, 'registration')).toBeNull();
  });

  it('finds and revokes a session by token hash without storing the raw token', async () => {
    const principalId = await createPrincipal();
    const sessionHash = hashOpaqueToken('session-value');
    await repository.createSession({
      principalId,
      sessionHash,
      expiresAt: new Date(Date.now() + 60_000),
      verifiedAt: new Date(),
    });

    expect((await repository.findActiveSession(sessionHash))?.principalId).toBe(principalId);
    const requestId = '018f4f5d-8f6a-7a13-8e2c-1f21f3489a21';
    await repository.revokeSession(sessionHash, requestId);
    expect(await repository.findActiveSession(sessionHash)).toBeNull();

    const stored = await pool.query<{ encoded: string }>(
      "select encode(session_hash, 'hex') as encoded from auth_sessions limit 1",
    );
    expect(stored.rows[0]?.encoded).toBe(sessionHash.toString('hex'));
    expect(stored.rows[0]?.encoded).not.toContain('session-value');
    const audit = await pool.query<{ event_type: string; request_id: string }>(
      `select event_type, request_id from security_audit_events
       where actor_principal_id = $1 and event_type = 'session.revoked'`,
      [principalId],
    );
    expect(audit.rows[0]).toEqual({ event_type: 'session.revoked', request_id: requestId });
  });

  it('enforces a shared rate limit atomically and reports the retry delay', async () => {
    const now = new Date('2026-08-08T10:00:00.000Z');
    const input = {
      scope: 'passkey.registration',
      keyHash: hashOpaqueToken('registration-rate-key'),
      maxAttempts: 2,
      windowMs: 60_000,
      now,
    };

    expect(await repository.consumeRateLimit(input)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await repository.consumeRateLimit(input)).toMatchObject({ allowed: true, remaining: 0 });
    expect(await repository.consumeRateLimit(input)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
    expect(await repository.consumeRateLimit({
      ...input,
      now: new Date(now.getTime() + 60_001),
    })).toMatchObject({ allowed: true, remaining: 1 });
  });
});
