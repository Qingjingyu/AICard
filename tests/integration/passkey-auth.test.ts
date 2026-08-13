import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import { createOpaqueToken } from '@/server/authentication/auth-security';
import {
  AuthenticationService,
  type WebAuthnAdapter,
} from '@/server/authentication/authentication-service';
import { AuthenticationStateError } from '@/server/authentication/errors';
import { PasswordAuthenticationService } from '@/server/authentication/password-authentication-service';
import { PostgresAuthenticationRepository } from '@/server/postgres/authentication-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for passkey tests');

const pool = createPostgresPool(databaseUrl);
const repository = new PostgresAuthenticationRepository(pool);

type FakeResponse = { id: string; challenge: string; counter?: number };

const adapter: WebAuthnAdapter = {
  async generateRegistrationOptions(input) {
    return {
      challenge: createOpaqueToken(),
      rp: { id: input.rpId, name: input.rpName },
      user: { id: input.userId, name: input.userName, displayName: input.displayName },
      excludeCredentials: input.excludeCredentials,
    };
  },
  async verifyRegistration(input) {
    const response = input.response as FakeResponse;
    const verified = await input.expectedChallenge(response.challenge);
    return verified ? {
      verified: true,
      credential: {
        id: response.id,
        publicKey: new Uint8Array([1, 2, 3]),
        counter: response.counter ?? 0,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: true,
      },
    } : { verified: false };
  },
  async generateAuthenticationOptions(input) {
    return { challenge: createOpaqueToken(), rpId: input.rpId, userVerification: 'required' };
  },
  async verifyAuthentication(input) {
    const response = input.response as FakeResponse;
    const verified = await input.expectedChallenge(response.challenge);
    return verified ? { verified: true, newCounter: response.counter ?? input.credential.counter } : {
      verified: false,
      newCounter: input.credential.counter,
    };
  },
};

const service = new AuthenticationService(repository, adapter, {
  rpName: 'AI Card',
  rpId: 'localhost',
  origin: 'http://localhost:3000',
});
const passwordService = new PasswordAuthenticationService(repository);

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

beforeEach(async () => {
  await pool.query('delete from principals');
  await pool.query('delete from auth_challenges');
  await pool.query('delete from auth_rate_limits');
  await pool.query('delete from security_audit_events');
});

afterAll(async () => {
  await pool.end();
});

async function register(credentialId = 'credential_one') {
  const begun = await service.beginInitialRegistration({
    displayName: '  苏白  ',
    handle: 'subai_passkey',
  });
  const challenge = (begun.options as { challenge: string }).challenge;
  return service.finishRegistration({
    challengeId: begun.challengeId,
    response: { id: credentialId, challenge },
    requestId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a20',
  });
}

describe('Passkey authentication service', () => {
  it('adds the first optional Passkey to an account originally created with a password', async () => {
    const passwordAccount = await passwordService.register({
      clientId: 'test_client',
      idempotencyKey: 'passkey-upgrade-test-key-00000001',
      displayName: '密码用户',
      handle: 'password_then_passkey',
      password: 'correct horse 电池 staple',
    });

    const additional = await service.beginAdditionalCredential(passwordAccount.card.principalId);
    await service.finishRegistration({
      challengeId: additional.challengeId,
      currentPrincipalId: passwordAccount.card.principalId,
      response: {
        id: 'credential_after_password',
        challenge: (additional.options as { challenge: string }).challenge,
      },
    });

    expect(await service.listCredentials(passwordAccount.card.principalId)).toEqual([
      expect.objectContaining({ credentialId: 'credential_after_password', revokedAt: null }),
    ]);
  });

  it('creates a human Card, credential, and hashed session in one registration flow', async () => {
    const result = await register();

    expect(result.card).toMatchObject({ displayName: '苏白', handle: 'subai_passkey' });
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await service.resolveSession(result.sessionToken!)).toMatchObject({
      principalId: result.card.principalId,
    });
    expect(await service.listCredentials(result.card.principalId)).toEqual([
      expect.objectContaining({ credentialId: 'credential_one', revokedAt: null }),
    ]);
  });

  it('consumes the registration challenge even when the response is replayed', async () => {
    const begun = await service.beginInitialRegistration({
      displayName: '挑战测试',
      handle: 'challenge_test',
    });
    const response = {
      id: 'credential_replay',
      challenge: (begun.options as { challenge: string }).challenge,
    };

    await service.finishRegistration({ challengeId: begun.challengeId, response });
    await expect(service.finishRegistration({ challengeId: begun.challengeId, response }))
      .rejects.toBeInstanceOf(AuthenticationStateError);
  });

  it('logs in with a discoverable credential, advances its counter, and rotates a session', async () => {
    const registered = await register();
    const begun = await service.beginAuthentication();
    const authenticated = await service.finishAuthentication({
      challengeId: begun.challengeId,
      response: {
        id: 'credential_one',
        challenge: (begun.options as { challenge: string }).challenge,
        counter: 4,
      },
      currentSessionToken: registered.sessionToken!,
    });

    expect(authenticated.principalId).toBe(registered.card.principalId);
    expect(authenticated.sessionToken).not.toBe(registered.sessionToken);
    expect(await service.resolveSession(registered.sessionToken!)).toBeNull();
    expect((await service.listCredentials(registered.card.principalId))[0]?.counter).toBe(4);
  });

  it('allows one credential to be revoked but protects the last active credential', async () => {
    const registered = await register();
    const additional = await service.beginAdditionalCredential(registered.card.principalId);
    await service.finishRegistration({
      challengeId: additional.challengeId,
      currentPrincipalId: registered.card.principalId,
      response: {
        id: 'credential_two',
        challenge: (additional.options as { challenge: string }).challenge,
      },
    });

    await service.revokeCredential(registered.card.principalId, 'credential_one');
    expect((await service.listCredentials(registered.card.principalId)).filter((item) => !item.revokedAt))
      .toHaveLength(1);
    await expect(service.revokeCredential(registered.card.principalId, 'credential_two'))
      .rejects.toBeInstanceOf(AuthenticationStateError);
  });
});
