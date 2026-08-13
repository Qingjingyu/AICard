import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import { createS256CodeChallenge } from '@/domain/authorization/scopes';
import { IdentityService } from '@/server/identity-service';
import { PlatformAuthorizationError } from '@/server/authorization/errors';
import { PlatformAuthorizationService } from '@/server/authorization/authorization-service';
import { hashOpaqueToken } from '@/server/authentication/auth-security';
import { PostgresIdentityRepository } from '@/server/postgres/identity-repository';
import { PostgresPlatformAuthorizationRepository } from '@/server/postgres/platform-authorization-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for platform authorization tests');

const pool = createPostgresPool(databaseUrl);
const repository = new PostgresPlatformAuthorizationRepository(pool);
const service = new PlatformAuthorizationService(repository);
const identities = new IdentityService(new PostgresIdentityRepository(pool));

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

beforeEach(async () => {
  await pool.query('delete from principals');
  await pool.query('delete from security_audit_events');
});

afterAll(async () => {
  await pool.end();
});

async function createHolder() {
  return identities.createCard({
    principalType: 'human',
    displayName: '苏白',
    handle: `platform_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`,
  });
}

function requestFor(clientId = 'yoyoo_dev') {
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    codeVerifier,
    request: {
      responseType: 'code',
      clientId,
      redirectUri: clientId === 'yoyoo_dev'
        ? 'http://localhost:4173/auth/aicard/callback'
        : 'http://localhost:4174/callback',
      scope: 'card.basic card.handle',
      state: randomBytes(24).toString('base64url'),
      codeChallenge: createS256CodeChallenge(codeVerifier),
      codeChallengeMethod: 'S256',
      principalType: 'human',
    },
  } as const;
}

async function createControlledAgent(controllerPrincipalId: string, suffix: string) {
  return identities.createCard({
    principalType: 'ai',
    controllerPrincipalId,
    displayName: `研究助理 ${suffix}`,
    handle: `agent_${suffix}_${randomBytes(2).toString('hex')}`,
  });
}

function idempotencyKey() {
  return `idem_${randomBytes(24).toString('base64url')}`;
}

describe('platform authorization service', () => {
  it('authorizes a controlled AI Card as the platform subject', async () => {
    const controller = await createHolder();
    const agent = await createControlledAgent(controller.principalId, 'controlled');
    const authorization = requestFor();
    const request = { ...authorization.request, principalType: 'ai' as const };

    const approved = await service.resolveConsent({
      principalId: controller.principalId,
      subjectPrincipalId: agent.principalId,
      decision: 'approve',
      request,
    });
    const token = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier: authorization.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });

    expect(await service.getUserInfo(token.accessToken)).toMatchObject({
      sub: token.subject,
      display_name: agent.displayName,
      principal_type: 'ai',
      handle: agent.handle,
    });
    expect((await pool.query(
      'select principal_id from platform_grants where client_id = $1',
      ['yoyoo_dev'],
    )).rows).toEqual([{ principal_id: agent.principalId }]);
  });

  it('rejects a foreign or wrong-type principal for AI authorization', async () => {
    const controller = await createHolder();
    const otherController = await createHolder();
    const foreignAgent = await createControlledAgent(otherController.principalId, 'foreign');
    const authorization = requestFor();
    const request = { ...authorization.request, principalType: 'ai' as const };

    await expect(service.resolveConsent({
      principalId: controller.principalId,
      subjectPrincipalId: foreignAgent.principalId,
      decision: 'approve',
      request,
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
    await expect(service.resolveConsent({
      principalId: controller.principalId,
      subjectPrincipalId: controller.principalId,
      decision: 'approve',
      request,
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
    expect((await pool.query('select grant_id from platform_grants')).rowCount).toBe(0);
  });

  it('strictly validates pre-registered clients, redirects, scopes, and PKCE', async () => {
    const { request } = requestFor();
    const validated = await service.validateRequest(request);

    expect(validated.client).toMatchObject({
      clientId: 'yoyoo_dev',
      displayName: 'Yoyoo',
      audience: 'yoyoo',
    });
    expect(validated.scopes).toEqual(['card.basic', 'card.handle']);

    await expect(service.validateRequest({ ...request, clientId: 'unknown_client' }))
      .rejects.toBeInstanceOf(PlatformAuthorizationError);
    await expect(service.validateRequest({ ...request, redirectUri: `${request.redirectUri}/extra` }))
      .rejects.toBeInstanceOf(PlatformAuthorizationError);
    expect((await service.validateRequest({ ...request, scope: 'card.basic offline_access' })).scopes)
      .toEqual(['card.basic', 'offline_access']);
    const testClient = requestFor('test_client').request;
    await expect(service.validateRequest({ ...testClient, scope: 'card.basic offline_access' }))
      .rejects.toBeInstanceOf(PlatformAuthorizationError);
    await expect(service.validateRequest({ ...request, codeChallengeMethod: 'plain' }))
      .rejects.toBeInstanceOf(PlatformAuthorizationError);
  });

  it('allows only the pre-registered Yoyoo client to request Agent runtime access', async () => {
    const yoyoo = requestFor('yoyoo_dev').request;
    const testClient = requestFor('test_client').request;

    await expect(service.validateRequest({
      ...yoyoo,
      scope: 'card.basic agent.runtime',
      principalType: 'ai',
    })).resolves.toMatchObject({ scopes: ['card.basic', 'agent.runtime'] });
    await expect(service.validateRequest({
      ...testClient,
      scope: 'card.basic agent.runtime',
      principalType: 'ai',
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
  });

  it('approves a request, stores only hashes, exchanges once, and projects userinfo', async () => {
    const holder = await createHolder();
    const { request, codeVerifier } = requestFor();
    const approved = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request,
    });

    expect(approved.redirectUrl).toContain(request.redirectUri);
    expect(approved.redirectUrl).toContain(`state=${request.state}`);
    expect(approved.code).toMatch(/^ac_[A-Za-z0-9_-]{43}$/);

    const storedCode = await pool.query<{ code_hash: Buffer }>(
      'select code_hash from authorization_codes',
    );
    expect(storedCode.rows[0]?.code_hash.equals(hashOpaqueToken(approved.code!))).toBe(true);
    expect(JSON.stringify(storedCode.rows)).not.toContain(approved.code);

    const token = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier,
      idempotencyKey: idempotencyKey(),
    });
    expect(token).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 600,
      scope: 'card.basic card.handle',
    });
    expect(token.accessToken).toMatch(/^at_[A-Za-z0-9_-]{43}$/);

    const storedToken = await pool.query<{ token_hash: Buffer }>(
      'select token_hash from platform_access_tokens',
    );
    expect(storedToken.rows[0]?.token_hash.equals(hashOpaqueToken(token.accessToken))).toBe(true);
    expect(JSON.stringify(storedToken.rows)).not.toContain(token.accessToken);

    expect(await service.getUserInfo(token.accessToken)).toEqual({
      sub: token.subject,
      display_name: '苏白',
      principal_type: 'human',
      avatar_url: null,
      handle: holder.handle,
    });

    await expect(service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier,
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
  });

  it('rejects a wrong PKCE verifier without issuing a token', async () => {
    const holder = await createHolder();
    const { request } = requestFor();
    const approved = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request,
    });

    await expect(service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier: randomBytes(32).toString('base64url'),
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
    expect((await pool.query('select token_hash from platform_access_tokens')).rowCount).toBe(0);
  });

  it('rejects expired codes and access tokens', async () => {
    const holder = await createHolder();
    const expiredCodeRequest = requestFor();
    const expiredCodeApproval = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: expiredCodeRequest.request,
    });
    await pool.query(
      `update authorization_codes
       set created_at = now() - interval '10 minutes',
           expires_at = now() - interval '5 minutes'`,
    );
    await expect(service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: expiredCodeRequest.request.clientId,
      redirectUri: expiredCodeRequest.request.redirectUri,
      code: expiredCodeApproval.code!,
      codeVerifier: expiredCodeRequest.codeVerifier,
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);

    const accessRequest = requestFor();
    const accessApproval = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: accessRequest.request,
    });
    const access = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: accessRequest.request.clientId,
      redirectUri: accessRequest.request.redirectUri,
      code: accessApproval.code!,
      codeVerifier: accessRequest.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });
    await pool.query(
      `update platform_access_tokens
       set created_at = now() - interval '20 minutes',
           expires_at = now() - interval '10 minutes'`,
    );
    await expect(service.getUserInfo(access.accessToken)).rejects.toThrow('invalid or expired');

    const refreshRequest = requestFor();
    const refreshApproval = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: { ...refreshRequest.request, scope: 'card.basic offline_access' },
    });
    const refresh = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: refreshRequest.request.clientId,
      redirectUri: refreshRequest.request.redirectUri,
      code: refreshApproval.code!,
      codeVerifier: refreshRequest.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });
    await pool.query(
      `update platform_refresh_token_families
       set created_at = now() - interval '40 days', expires_at = now() - interval '10 days'`,
    );
    await pool.query(
      `update platform_refresh_tokens
       set created_at = now() - interval '40 days', expires_at = now() - interval '10 days'`,
    );
    await expect(service.exchangeRefreshToken({
      grantType: 'refresh_token',
      clientId: refreshRequest.request.clientId,
      refreshToken: refresh.refreshToken!,
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
  });

  it('denies without creating authorization material and preserves state', async () => {
    const holder = await createHolder();
    const { request } = requestFor();
    const denied = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'deny',
      request,
    });

    expect(denied.code).toBeUndefined();
    expect(denied.redirectUrl).toContain('error=access_denied');
    expect(denied.redirectUrl).toContain(`state=${request.state}`);
    expect((await pool.query('select grant_id from platform_grants')).rowCount).toBe(0);
    expect((await pool.query('select code_hash from authorization_codes')).rowCount).toBe(0);
  });

  it('returns different stable subjects to different clients for one Card', async () => {
    const holder = await createHolder();
    const yoyoo = requestFor('yoyoo_dev');
    const testClient = requestFor('test_client');
    const yoyooRequest = { ...yoyoo.request, scope: 'card.basic card.handle card.id' };
    const testClientRequest = { ...testClient.request, scope: 'card.basic card.handle card.id' };

    const yoyooApproval = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: yoyooRequest,
    });
    const testApproval = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: testClientRequest,
    });
    const yoyooToken = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: yoyooRequest.clientId,
      redirectUri: yoyooRequest.redirectUri,
      code: yoyooApproval.code!,
      codeVerifier: yoyoo.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });
    const testToken = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: testClientRequest.clientId,
      redirectUri: testClientRequest.redirectUri,
      code: testApproval.code!,
      codeVerifier: testClient.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });
    const [yoyooProfile, testClientProfile] = await Promise.all([
      service.getUserInfo(yoyooToken.accessToken),
      service.getUserInfo(testToken.accessToken),
    ]);

    expect(yoyooToken.subject).not.toBe(testToken.subject);
    expect(yoyooProfile).toMatchObject({ sub: yoyooToken.subject, card_id: holder.cardId });
    expect(testClientProfile).toMatchObject({ sub: testToken.subject, card_id: holder.cardId });
    expect((await pool.query(
      'select subject from platform_subjects where principal_id = $1',
      [holder.principalId],
    )).rowCount).toBe(2);
    expect((await pool.query('select card_id from ai_cards')).rows).toEqual([{ card_id: holder.cardId }]);
  });

  it('does not approve or exchange authorization material for a non-active Card', async () => {
    const holder = await createHolder();
    const suspendedRequest = requestFor();
    await pool.query("update ai_cards set status = 'suspended' where principal_id = $1", [holder.principalId]);
    await expect(service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: suspendedRequest.request,
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);

    await pool.query("update ai_cards set status = 'active' where principal_id = $1", [holder.principalId]);
    const activeRequest = requestFor();
    const approved = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request: activeRequest.request,
    });
    await pool.query("update ai_cards set status = 'suspended' where principal_id = $1", [holder.principalId]);
    await expect(service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: activeRequest.request.clientId,
      redirectUri: activeRequest.request.redirectUri,
      code: approved.code!,
      codeVerifier: activeRequest.codeVerifier,
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
    expect((await pool.query('select token_hash from platform_access_tokens')).rowCount).toBe(0);
  });

  it('recovers token responses idempotently, rotates refresh tokens, and revokes a family on replay', async () => {
    const holder = await createHolder();
    const authorization = requestFor();
    const request = { ...authorization.request, scope: 'card.basic card.handle offline_access' };
    const approved = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request,
    });
    const exchangeKey = idempotencyKey();
    const exchange = {
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier: authorization.codeVerifier,
      idempotencyKey: exchangeKey,
    };

    const [first, recovered] = await Promise.all([
      service.exchangeAuthorizationCode(exchange),
      service.exchangeAuthorizationCode(exchange),
    ]);
    expect(recovered).toEqual(first);
    expect(first.refreshToken).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);

    const rotationKey = idempotencyKey();
    const rotation = {
      grantType: 'refresh_token',
      clientId: request.clientId,
      refreshToken: first.refreshToken!,
      idempotencyKey: rotationKey,
    };
    const [rotated, recoveredRotation] = await Promise.all([
      service.exchangeRefreshToken(rotation),
      service.exchangeRefreshToken(rotation),
    ]);
    expect(recoveredRotation).toEqual(rotated);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.accessToken).not.toBe(first.accessToken);

    await expect(service.exchangeRefreshToken({
      grantType: 'refresh_token',
      clientId: request.clientId,
      refreshToken: first.refreshToken!,
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
    await expect(service.getUserInfo(rotated.accessToken)).rejects.toThrow('invalid or expired');

    const stored = await pool.query(
      `select encode(token_hash, 'hex') as token_hash from platform_access_tokens
       union all
       select encode(token_hash, 'hex') from platform_refresh_tokens`,
    );
    expect(JSON.stringify(stored.rows)).not.toContain(first.accessToken);
    expect(JSON.stringify(stored.rows)).not.toContain(first.refreshToken);
    expect((await pool.query(
      "select family_id from platform_refresh_token_families where status = 'revoked'",
    )).rowCount).toBe(1);
  });

  it('lists only the holder grants and revokes authorization material atomically', async () => {
    const holder = await createHolder();
    const otherHolder = await createHolder();
    const authorization = requestFor();
    const request = { ...authorization.request, scope: 'card.basic offline_access' };
    const approved = await service.resolveConsent({
      principalId: holder.principalId,
      decision: 'approve',
      request,
    });
    const token = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier: authorization.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });

    const grants = await service.listGrants(holder.principalId);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      clientId: 'yoyoo_dev',
      clientDisplayName: 'Yoyoo',
      audience: 'yoyoo',
      scopes: ['card.basic', 'offline_access'],
      status: 'active',
    });
    expect(await service.listGrants(otherHolder.principalId)).toEqual([]);

    await expect(service.revokeGrant({
      principalId: otherHolder.principalId,
      grantId: grants[0]!.grantId,
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);

    await service.revokeGrant({ principalId: holder.principalId, grantId: grants[0]!.grantId });
    await service.revokeGrant({ principalId: holder.principalId, grantId: grants[0]!.grantId });
    expect((await service.listGrants(holder.principalId))[0]?.status).toBe('revoked');
    await expect(service.getUserInfo(token.accessToken)).rejects.toThrow('invalid or expired');
    await expect(service.exchangeRefreshToken({
      grantType: 'refresh_token',
      clientId: request.clientId,
      refreshToken: token.refreshToken!,
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);

    expect((await pool.query(
      "select event_id from security_audit_events where event_type = 'platform.grant.revoked'",
    )).rowCount).toBe(1);
  });

  it('lets a controller list and revoke a controlled AI grant without changing its subject', async () => {
    const controller = await createHolder();
    const otherController = await createHolder();
    const agent = await createControlledAgent(controller.principalId, 'managed_grant');
    const authorization = requestFor();
    const request = {
      ...authorization.request,
      principalType: 'ai' as const,
      scope: 'card.basic agent.runtime offline_access',
    };
    const approved = await service.resolveConsent({
      principalId: controller.principalId,
      subjectPrincipalId: agent.principalId,
      decision: 'approve',
      request,
    });
    const token = await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier: authorization.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });

    const manageable = await service.listManageableGrants(controller.principalId);
    expect(manageable).toHaveLength(1);
    expect(manageable[0]).toMatchObject({
      clientId: 'yoyoo_dev',
      status: 'active',
      subject: {
        principalType: 'ai',
        cardId: agent.cardId,
        displayName: agent.displayName,
        handle: agent.handle,
      },
    });
    expect(await service.listManageableGrants(otherController.principalId)).toEqual([]);
    await expect(service.revokeManageableGrant({
      actorPrincipalId: otherController.principalId,
      grantId: manageable[0]!.grantId,
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);

    await service.revokeManageableGrant({
      actorPrincipalId: controller.principalId,
      grantId: manageable[0]!.grantId,
    });
    await expect(service.getUserInfo(token.accessToken)).rejects.toThrow('invalid or expired');
    await expect(service.exchangeRefreshToken({
      grantType: 'refresh_token',
      clientId: request.clientId,
      refreshToken: token.refreshToken!,
      idempotencyKey: idempotencyKey(),
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);

    const audit = await pool.query<{
      actor_principal_id: string;
      metadata: { subject_principal_id?: string };
    }>(
      `select actor_principal_id, metadata
       from security_audit_events
       where event_type = 'platform.grant.revoked'`,
    );
    expect(audit.rows).toEqual([{
      actor_principal_id: controller.principalId,
      metadata: expect.objectContaining({ subject_principal_id: agent.principalId }),
    }]);
  });

  it('removes grant management access as soon as the AI control relationship is revoked', async () => {
    const controller = await createHolder();
    const agent = await createControlledAgent(controller.principalId, 'revoked_control');
    const authorization = requestFor();
    const request = { ...authorization.request, principalType: 'ai' as const };
    const approved = await service.resolveConsent({
      principalId: controller.principalId,
      subjectPrincipalId: agent.principalId,
      decision: 'approve',
      request,
    });
    await service.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier: authorization.codeVerifier,
      idempotencyKey: idempotencyKey(),
    });
    const grant = (await service.listGrants(agent.principalId))[0]!;

    await pool.query(
      `update principal_controllers
       set revoked_at = now()
       where controlled_principal_id = $1 and controller_principal_id = $2`,
      [agent.principalId, controller.principalId],
    );

    expect(await service.listManageableGrants(controller.principalId)).toEqual([]);
    await expect(service.revokeManageableGrant({
      actorPrincipalId: controller.principalId,
      grantId: grant.grantId,
    })).rejects.toBeInstanceOf(PlatformAuthorizationError);
    expect((await service.listGrants(agent.principalId))[0]?.status).toBe('active');
  });
});
