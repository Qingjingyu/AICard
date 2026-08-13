import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { displayNameSchema, handleSchema, principalIdSchema } from '@/domain/identity/schemas';
import type { IdentityRecord } from '@/domain/identity/types';
import {
  createOpaqueToken,
  hashOpaqueToken,
} from '@/server/authentication/auth-security';
import {
  AuthenticationStateError,
  AuthenticationVerificationError,
} from '@/server/authentication/errors';
import type {
  CredentialInput,
  PostgresAuthenticationRepository,
  StoredCredential,
} from '@/server/postgres/authentication-repository';

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const credentialResponseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/),
}).passthrough();

export type RegistrationCredential = {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
};

export type WebAuthnAdapter = {
  generateRegistrationOptions(input: {
    rpName: string;
    rpId: string;
    userId: string;
    userName: string;
    displayName: string;
    excludeCredentials: Array<{ id: string; transports: string[] }>;
  }): Promise<unknown & { challenge: string }>;
  verifyRegistration(input: {
    response: unknown;
    expectedChallenge(challenge: string): boolean | Promise<boolean>;
    expectedOrigin: string;
    expectedRpId: string;
  }): Promise<{ verified: false } | { verified: true; credential: RegistrationCredential }>;
  generateAuthenticationOptions(input: { rpId: string }): Promise<unknown & { challenge: string }>;
  verifyAuthentication(input: {
    response: unknown;
    expectedChallenge(challenge: string): boolean | Promise<boolean>;
    expectedOrigin: string;
    expectedRpId: string;
    credential: StoredCredential;
  }): Promise<{ verified: boolean; newCounter: number }>;
};

type WebAuthnConfig = { rpName: string; rpId: string; origin: string };

function challengeMatches(expectedHash: Buffer, challenge: string): boolean {
  const actualHash = hashOpaqueToken(challenge);
  return timingSafeEqual(expectedHash, actualHash);
}

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

export class AuthenticationService {
  constructor(
    private readonly repository: PostgresAuthenticationRepository,
    private readonly webauthn: WebAuthnAdapter,
    private readonly config: WebAuthnConfig,
  ) {}

  async beginInitialRegistration(input: { displayName: string; handle: string }) {
    const displayName = displayNameSchema.parse(input.displayName);
    const handle = handleSchema.parse(input.handle);
    const webauthnUserId = createOpaqueToken();
    const options = await this.webauthn.generateRegistrationOptions({
      rpName: this.config.rpName,
      rpId: this.config.rpId,
      userId: webauthnUserId,
      userName: handle,
      displayName,
      excludeCredentials: [],
    });
    const { challengeId } = await this.repository.issueChallenge({
      purpose: 'registration',
      challengeHash: hashOpaqueToken(options.challenge),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      pendingDisplayName: displayName,
      pendingHandle: handle,
      webauthnUserId,
    });
    return { challengeId, options };
  }

  async beginAdditionalCredential(principalId: string) {
    const parsedPrincipalId = principalIdSchema.parse(principalId);
    const [existingProfile, credentials] = await Promise.all([
      this.repository.findAuthProfile(parsedPrincipalId),
      this.repository.listCredentials(parsedPrincipalId),
    ]);
    const profile = existingProfile ?? await this.repository.ensureAuthProfile(
      parsedPrincipalId,
      createOpaqueToken(),
    );
    const options = await this.webauthn.generateRegistrationOptions({
      rpName: this.config.rpName,
      rpId: this.config.rpId,
      userId: profile.webauthnUserId,
      userName: parsedPrincipalId,
      displayName: parsedPrincipalId,
      excludeCredentials: credentials
        .filter((credential) => !credential.revokedAt)
        .map((credential) => ({
          id: credential.credentialId,
          transports: credential.transports,
        })),
    });
    const { challengeId } = await this.repository.issueChallenge({
      purpose: 'registration',
      challengeHash: hashOpaqueToken(options.challenge),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      principalId: parsedPrincipalId,
      webauthnUserId: profile.webauthnUserId,
    });
    return { challengeId, options };
  }

  async finishRegistration(input: {
    challengeId: string;
    response: unknown;
    currentPrincipalId?: string;
    requestId?: string;
  }): Promise<{
    card: IdentityRecord;
    sessionToken?: string;
    csrfToken?: string;
  }> {
    const challengeId = principalIdSchema.parse(input.challengeId);
    credentialResponseSchema.parse(input.response);
    const challenge = await this.repository.consumeChallenge(challengeId, 'registration');
    if (!challenge || !challenge.webauthnUserId) {
      throw new AuthenticationStateError('Registration challenge is expired or already used');
    }
    const verification = await this.webauthn.verifyRegistration({
      response: input.response,
      expectedChallenge: (actual) => challengeMatches(challenge.challengeHash, actual),
      expectedOrigin: this.config.origin,
      expectedRpId: this.config.rpId,
    });
    if (!verification.verified) throw new AuthenticationVerificationError();

    const credential: CredentialInput = verification.credential;
    if (challenge.principalId) {
      if (challenge.principalId !== input.currentPrincipalId) {
        throw new AuthenticationVerificationError();
      }
      await this.repository.addCredential({
        principalId: challenge.principalId,
        credential,
        requestId: input.requestId,
      });
      const card = await this.repository.findIdentityByPrincipalId(challenge.principalId);
      if (!card) throw new AuthenticationStateError('Card was not found after credential registration');
      return { card };
    }

    if (!challenge.pendingDisplayName || !challenge.pendingHandle) {
      throw new AuthenticationStateError('Registration challenge has no pending Card identity');
    }
    const artifacts = sessionArtifacts();
    const card = await this.repository.completeInitialRegistration({
      displayName: challenge.pendingDisplayName,
      handle: challenge.pendingHandle,
      webauthnUserId: challenge.webauthnUserId,
      credential,
      sessionHash: artifacts.sessionHash,
      sessionExpiresAt: artifacts.expiresAt,
      verifiedAt: artifacts.verifiedAt,
      requestId: input.requestId,
    });
    return { card, sessionToken: artifacts.sessionToken, csrfToken: artifacts.csrfToken };
  }

  async beginAuthentication(principalId?: string) {
    const parsedPrincipalId = principalId ? principalIdSchema.parse(principalId) : undefined;
    const options = await this.webauthn.generateAuthenticationOptions({ rpId: this.config.rpId });
    const { challengeId } = await this.repository.issueChallenge({
      purpose: 'authentication',
      challengeHash: hashOpaqueToken(options.challenge),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      principalId: parsedPrincipalId,
    });
    return { challengeId, options };
  }

  async finishAuthentication(input: {
    challengeId: string;
    response: unknown;
    currentSessionToken?: string;
    requestId?: string;
  }): Promise<{
    principalId: string;
    sessionToken: string;
    csrfToken: string;
  }> {
    const challengeId = principalIdSchema.parse(input.challengeId);
    const response = credentialResponseSchema.parse(input.response);
    const challenge = await this.repository.consumeChallenge(challengeId, 'authentication');
    if (!challenge) {
      throw new AuthenticationStateError('Authentication challenge is expired or already used');
    }
    const credential = await this.repository.findActiveCredential(response.id);
    if (!credential) throw new AuthenticationVerificationError();
    if (challenge.principalId && challenge.principalId !== credential.principalId) {
      throw new AuthenticationVerificationError();
    }
    const verification = await this.webauthn.verifyAuthentication({
      response: input.response,
      expectedChallenge: (actual) => challengeMatches(challenge.challengeHash, actual),
      expectedOrigin: this.config.origin,
      expectedRpId: this.config.rpId,
      credential,
    });
    if (!verification.verified) throw new AuthenticationVerificationError();

    const artifacts = sessionArtifacts();
    const currentSessionToken = input.currentSessionToken
      ? opaqueTokenSchema.safeParse(input.currentSessionToken)
      : null;
    await this.repository.completeAuthentication({
      credential,
      newCounter: verification.newCounter,
      previousSessionHash: currentSessionToken?.success
        ? hashOpaqueToken(currentSessionToken.data)
        : undefined,
      sessionHash: artifacts.sessionHash,
      sessionExpiresAt: artifacts.expiresAt,
      verifiedAt: artifacts.verifiedAt,
      requestId: input.requestId,
    });
    return {
      principalId: credential.principalId,
      sessionToken: artifacts.sessionToken,
      csrfToken: artifacts.csrfToken,
    };
  }

  async resolveSession(token: string) {
    const parsed = opaqueTokenSchema.safeParse(token);
    if (!parsed.success) return null;
    return this.repository.findActiveSession(hashOpaqueToken(parsed.data));
  }

  listCredentials(principalId: string) {
    return this.repository.listCredentials(principalIdSchema.parse(principalId));
  }

  revokeCredential(principalId: string, credentialId: string, requestId?: string) {
    return this.repository.revokeCredential(
      principalIdSchema.parse(principalId),
      credentialResponseSchema.shape.id.parse(credentialId),
      requestId,
    );
  }

  consumeRateLimit(input: Parameters<PostgresAuthenticationRepository['consumeRateLimit']>[0]) {
    return this.repository.consumeRateLimit(input);
  }

  async revokeSession(token: string, requestId?: string): Promise<void> {
    const parsed = opaqueTokenSchema.safeParse(token);
    if (!parsed.success) return;
    await this.repository.revokeSession(hashOpaqueToken(parsed.data), requestId);
  }
}
