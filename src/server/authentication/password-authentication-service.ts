import { createHash } from 'node:crypto';

import { z } from 'zod';

import { cardIdSchema, displayNameSchema, handleSchema } from '@/domain/identity/schemas';
import type { IdentityRecord } from '@/domain/identity/types';
import { createOpaqueToken, hashOpaqueToken } from '@/server/authentication/auth-security';
import {
  AuthenticationVerificationError,
} from '@/server/authentication/errors';
import {
  hashPassword,
  passwordSchema,
  verifyPassword,
} from '@/server/authentication/password-security';
import type { PostgresAuthenticationRepository } from '@/server/postgres/authentication-repository';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const clientIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const loginIdentifierSchema = z.string().trim().min(3).max(64);
const loginPasswordSchema = z.string().max(128);

function sessionArtifacts(now = new Date()) {
  const sessionToken = createOpaqueToken();
  return {
    sessionToken,
    csrfToken: createOpaqueToken(),
    sessionHash: hashOpaqueToken(sessionToken),
    verifiedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  };
}

function normalizeIdentifier(identifier: string): { cardId?: string; handle?: string } {
  const value = loginIdentifierSchema.parse(identifier);
  const cardId = cardIdSchema.safeParse(value);
  if (cardId.success) return { cardId: cardId.data };
  const handle = handleSchema.safeParse(value.replace(/^@/, '').toLowerCase());
  return handle.success ? { handle: handle.data } : {};
}

const dummyCredential = hashPassword('invalid account timing password');

export class PasswordAuthenticationService {
  constructor(private readonly repository: PostgresAuthenticationRepository) {}

  async register(input: {
    clientId: string;
    idempotencyKey: string;
    displayName: string;
    handle: string;
    password: string;
    requestId?: string;
  }): Promise<{
    card: IdentityRecord;
    replayed: boolean;
    sessionToken: string;
    csrfToken: string;
  }> {
    const clientId = clientIdSchema.parse(input.clientId);
    const idempotencyKey = idempotencyKeySchema.parse(input.idempotencyKey);
    const displayName = displayNameSchema.parse(input.displayName);
    const handle = handleSchema.parse(input.handle);
    const password = passwordSchema.parse(input.password);
    const credential = await hashPassword(password);
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ clientId, displayName, handle }), 'utf8')
      .digest();
    const artifacts = sessionArtifacts();
    const result = await this.repository.registerPasswordAccount({
      clientId,
      idempotencyKeyHash: createHash('sha256').update(idempotencyKey, 'utf8').digest(),
      requestFingerprint,
      displayName,
      handle,
      password,
      credential,
      sessionHash: artifacts.sessionHash,
      sessionExpiresAt: artifacts.expiresAt,
      verifiedAt: artifacts.verifiedAt,
      requestId: input.requestId,
    });
    return {
      ...result,
      sessionToken: artifacts.sessionToken,
      csrfToken: artifacts.csrfToken,
    };
  }

  async login(input: {
    identifier: string;
    password: string;
    previousSessionToken?: string;
    requestId?: string;
  }): Promise<{
    card: IdentityRecord;
    sessionToken: string;
    csrfToken: string;
  }> {
    const password = loginPasswordSchema.parse(input.password);
    const identifier = normalizeIdentifier(input.identifier);
    const account = identifier.cardId || identifier.handle
      ? await this.repository.findPasswordAccount(identifier)
      : null;
    const credential = account?.credential ?? await dummyCredential;
    const verified = await verifyPassword(password, credential);
    if (!account || !verified || account.card.status !== 'active' || account.credentialStatus !== 'active') {
      await this.repository.recordPasswordLoginFailure(account?.card.principalId, input.requestId);
      throw new AuthenticationVerificationError('Account or password is invalid');
    }
    const artifacts = sessionArtifacts();
    await this.repository.createPasswordSession({
      principalId: account.card.principalId,
      sessionHash: artifacts.sessionHash,
      previousSessionHash: input.previousSessionToken
        ? hashOpaqueToken(input.previousSessionToken)
        : undefined,
      expiresAt: artifacts.expiresAt,
      verifiedAt: artifacts.verifiedAt,
      requestId: input.requestId,
    });
    return {
      card: account.card,
      sessionToken: artifacts.sessionToken,
      csrfToken: artifacts.csrfToken,
    };
  }

  resolveSession(token: string) {
    return this.repository.findActiveSession(hashOpaqueToken(token));
  }

  consumeRateLimit(input: Parameters<PostgresAuthenticationRepository['consumeRateLimit']>[0]) {
    return this.repository.consumeRateLimit(input);
  }
}
