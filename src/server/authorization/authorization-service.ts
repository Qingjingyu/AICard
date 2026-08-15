import { z } from 'zod';

import { createPrincipalId, createPairwiseSubject } from '@/domain/identity/ids';
import {
  createS256CodeChallenge,
  normalizeAuthorizationScopes,
} from '@/domain/authorization/scopes';
import type { PlatformTokenResponse, ValidatedAuthorizationRequest } from '@/domain/authorization/types';
import { projectPlatformCard } from '@/domain/identity/projections';
import { principalIdSchema } from '@/domain/identity/schemas';
import { PlatformAccessTokenError, PlatformAuthorizationError } from '@/server/authorization/errors';
import { createOpaqueToken, hashOpaqueToken } from '@/server/authentication/auth-security';
import type { PostgresPlatformAuthorizationRepository } from '@/server/postgres/platform-authorization-repository';

const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000;
const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1_000;
const REFRESH_TOKEN_FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const clientIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/);
const redirectUriSchema = z.url().max(2048);
const stateSchema = z.string().regex(/^[A-Za-z0-9._~-]{16,256}$/);
const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const authorizationCodeSchema = z.string().regex(/^ac_[A-Za-z0-9_-]{43}$/);
const accessTokenSchema = z.string().regex(/^at_[A-Za-z0-9_-]{43}$/);
const refreshTokenSchema = z.string().regex(/^rt_[A-Za-z0-9_-]{43}$/);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/);
const principalTypeSchema = z.enum(['human', 'ai']);

export type RawAuthorizationRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  principalType?: string;
};

export class PlatformAuthorizationService {
  constructor(private readonly repository: PostgresPlatformAuthorizationRepository) {}

  async validateRequest(input: RawAuthorizationRequest): Promise<ValidatedAuthorizationRequest> {
    try {
      if (input.responseType !== 'code' || input.codeChallengeMethod !== 'S256') {
        throw new PlatformAuthorizationError();
      }
      const clientId = clientIdSchema.parse(input.clientId);
      const redirectUri = redirectUriSchema.parse(input.redirectUri);
      const state = stateSchema.parse(input.state);
      const codeChallenge = codeChallengeSchema.parse(input.codeChallenge);
      const principalType = principalTypeSchema.parse(input.principalType || 'human');
      const scopes = normalizeAuthorizationScopes(input.scope);
      const client = await this.repository.findActiveClient(clientId, redirectUri);
      if (!client || scopes.some((scope) => !client.scopes.includes(scope))) {
        throw new PlatformAuthorizationError();
      }
      return { client, redirectUri, scopes, state, codeChallenge, principalType };
    } catch (error) {
      if (error instanceof PlatformAuthorizationError) throw error;
      throw new PlatformAuthorizationError();
    }
  }

  async resolveConsent(input: {
    principalId: string;
    subjectPrincipalId?: string;
    decision: 'approve' | 'deny';
    request: RawAuthorizationRequest;
    requestId?: string;
  }): Promise<{ redirectUrl: string; code?: string }> {
    const request = await this.validateRequest(input.request);
    const redirectUrl = new URL(request.redirectUri);
    redirectUrl.searchParams.set('state', request.state);

    if (input.decision === 'deny') {
      await this.repository.recordDenial({
        eventId: createPrincipalId(),
        principalId: input.principalId,
        clientId: request.client.clientId,
        scopes: request.scopes,
        requestId: input.requestId,
      });
      redirectUrl.searchParams.set('error', 'access_denied');
      return { redirectUrl: redirectUrl.toString() };
    }

    const code = `ac_${createOpaqueToken()}`;
    const subjectPrincipalId = input.subjectPrincipalId ?? input.principalId;
    await this.repository.issueAuthorizationCode({
      grantId: createPrincipalId(),
      eventId: createPrincipalId(),
      actorPrincipalId: input.principalId,
      principalId: subjectPrincipalId,
      principalType: request.principalType,
      clientId: request.client.clientId,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      codeChallenge: request.codeChallenge,
      codeHash: hashOpaqueToken(code),
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
      requestId: input.requestId,
    });
    redirectUrl.searchParams.set('code', code);
    return { redirectUrl: redirectUrl.toString(), code };
  }

  async exchangeAuthorizationCode(input: {
    grantType: string;
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
    idempotencyKey: string;
    requestId?: string;
  }): Promise<PlatformTokenResponse> {
    try {
      if (input.grantType !== 'authorization_code') throw new PlatformAuthorizationError();
      const clientId = clientIdSchema.parse(input.clientId);
      const redirectUri = redirectUriSchema.parse(input.redirectUri);
      const code = authorizationCodeSchema.parse(input.code);
      const idempotencyKey = idempotencyKeySchema.parse(input.idempotencyKey);
      const expectedCodeChallenge = createS256CodeChallenge(input.codeVerifier);
      const accessToken = `at_${createOpaqueToken()}`;
      const refreshToken = `rt_${createOpaqueToken()}`;
      return await this.repository.exchangeAuthorizationCode({
        codeHash: hashOpaqueToken(code),
        clientId,
        redirectUri,
        expectedCodeChallenge,
        subjectCandidate: createPairwiseSubject(),
        accessToken,
        tokenHash: hashOpaqueToken(accessToken),
        tokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
        refreshFamilyId: createPrincipalId(),
        refreshToken,
        refreshTokenHash: hashOpaqueToken(refreshToken),
        refreshFamilyExpiresAt: new Date(Date.now() + REFRESH_TOKEN_FAMILY_TTL_MS),
        idempotencyKey,
        idempotencyHash: hashOpaqueToken(idempotencyKey),
        recoverySecret: `${code}\0${input.codeVerifier}`,
        eventId: createPrincipalId(),
        requestId: input.requestId,
      });
    } catch (error) {
      if (error instanceof PlatformAuthorizationError) throw error;
      throw new PlatformAuthorizationError();
    }
  }

  async exchangeRefreshToken(input: {
    grantType: string;
    clientId: string;
    refreshToken: string;
    idempotencyKey: string;
    requestId?: string;
  }): Promise<PlatformTokenResponse> {
    try {
      if (input.grantType !== 'refresh_token') throw new PlatformAuthorizationError();
      const clientId = clientIdSchema.parse(input.clientId);
      const refreshToken = refreshTokenSchema.parse(input.refreshToken);
      const idempotencyKey = idempotencyKeySchema.parse(input.idempotencyKey);
      const nextAccessToken = `at_${createOpaqueToken()}`;
      const nextRefreshToken = `rt_${createOpaqueToken()}`;
      const result = await this.repository.rotateRefreshToken({
        clientId,
        tokenHash: hashOpaqueToken(refreshToken),
        recoverySecret: refreshToken,
        idempotencyKey,
        idempotencyHash: hashOpaqueToken(idempotencyKey),
        nextAccessToken,
        nextAccessTokenHash: hashOpaqueToken(nextAccessToken),
        nextAccessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
        nextRefreshToken,
        nextRefreshTokenHash: hashOpaqueToken(nextRefreshToken),
        eventId: createPrincipalId(),
        requestId: input.requestId,
      });
      if (result.kind === 'reused') throw new PlatformAuthorizationError('Refresh token reuse detected');
      return result.response;
    } catch (error) {
      if (error instanceof PlatformAuthorizationError) throw error;
      throw new PlatformAuthorizationError();
    }
  }

  async getUserInfo(accessToken: string) {
    const token = accessTokenSchema.safeParse(accessToken);
    if (!token.success) throw new PlatformAuthorizationError('Access token is invalid or expired');
    const result = await this.repository.findUserInfo(hashOpaqueToken(token.data));
    return projectPlatformCard(result.identity, { subject: result.subject, scopes: result.scopes });
  }

  async authenticateAccessToken(accessToken: string) {
    const token = accessTokenSchema.safeParse(accessToken);
    if (!token.success) throw new PlatformAccessTokenError('Access token is invalid or expired');
    return this.repository.findUserInfo(hashOpaqueToken(token.data));
  }

  async listGrants(principalId: string) {
    return this.repository.listGrants(principalId);
  }

  async listManageableGrants(actorPrincipalId: string) {
    return this.repository.listManageableGrants(principalIdSchema.parse(actorPrincipalId));
  }

  async revokeManageableGrant(input: {
    actorPrincipalId: string;
    grantId: string;
    requestId?: string;
  }): Promise<void> {
    try {
      await this.repository.revokeManageableGrant({
        actorPrincipalId: principalIdSchema.parse(input.actorPrincipalId),
        grantId: z.uuid().parse(input.grantId),
        eventId: createPrincipalId(),
        requestId: input.requestId,
      });
    } catch (error) {
      if (error instanceof PlatformAuthorizationError) throw error;
      throw new PlatformAuthorizationError('Grant could not be revoked');
    }
  }

  async revokeGrant(input: { principalId: string; grantId: string; requestId?: string }): Promise<void> {
    try {
      const grantId = z.uuid().parse(input.grantId);
      await this.repository.revokeGrant({
        principalId: input.principalId,
        grantId,
        eventId: createPrincipalId(),
        requestId: input.requestId,
      });
    } catch (error) {
      if (error instanceof PlatformAuthorizationError) throw error;
      throw new PlatformAuthorizationError('Grant could not be revoked');
    }
  }
}
