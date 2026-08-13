import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { createS256CodeChallenge } from '@/domain/authorization/scopes';
import type { RawAuthorizationRequest } from '@/server/authorization/authorization-service';
import { createOpaqueToken, hashOpaqueToken } from '@/server/authentication/auth-security';
import { openTokenResponse, sealTokenResponse } from '@/server/authorization/token-response-seal';
import type { ProductIdentityGateway } from '@/server/federation/product-identity-gateway';
import type {
  PostgresProductFederationRepository,
  ProductLoginResult,
} from '@/server/postgres/product-federation-repository';

const FLOW_TTL_MS = 10 * 60 * 1_000;
const PRODUCT_SESSION_TTL_MS = 10 * 60 * 1_000;
const flowTokenSchema = z.string().regex(/^pf_[A-Za-z0-9_-]{43}$/);
const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const codeSchema = z.string().regex(/^ac_[A-Za-z0-9_-]{43}$/);
const profileSchema = z.object({
  sub: z.string().regex(/^sub_[A-Za-z0-9_-]{43}$/),
  card_id: z.string().regex(/^AI_[1-9][0-9]{5,}$/),
  principal_type: z.enum(['human', 'ai']),
  display_name: z.string().min(1).max(64),
  handle: z.string().regex(/^[a-z][a-z0-9_]{2,31}$/),
});

export class ProductFederationError extends Error {
  constructor(message = 'Product login could not be completed') {
    super(message);
    this.name = 'ProductFederationError';
  }
}

export type ProductFederationFlow = {
  flowToken: string;
  state: string;
  request: RawAuthorizationRequest;
};

function hashesMatch(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export class ProductFederationService {
  constructor(
    private readonly identityGateway: ProductIdentityGateway,
    private readonly repository: PostgresProductFederationRepository,
    private readonly aiCardOrigin: string,
  ) {}

  async begin(input: { clientId: string; redirectUri: string }): Promise<ProductFederationFlow> {
    const flowToken = `pf_${createOpaqueToken()}`;
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const request: RawAuthorizationRequest = {
      responseType: 'code',
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scope: 'card.basic card.handle card.id',
      state,
      codeChallenge: createS256CodeChallenge(codeVerifier),
      codeChallengeMethod: 'S256',
      principalType: 'human',
    };
    await this.identityGateway.validateRequest(request);
    await this.repository.createFlow({
      flowHash: hashOpaqueToken(flowToken),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      stateHash: createHash('sha256').update(state, 'ascii').digest(),
      sealedVerifier: sealTokenResponse({ codeVerifier }, flowToken, state),
      expiresAt: new Date(Date.now() + FLOW_TTL_MS),
    });
    return { flowToken, state, request };
  }

  authorizationUrl(flow: ProductFederationFlow): string {
    const query = new URLSearchParams({
      response_type: flow.request.responseType,
      client_id: flow.request.clientId,
      redirect_uri: flow.request.redirectUri,
      scope: flow.request.scope,
      state: flow.request.state,
      code_challenge: flow.request.codeChallenge,
      code_challenge_method: flow.request.codeChallengeMethod,
      principal_type: flow.request.principalType ?? 'human',
    });
    return `${this.aiCardOrigin}/authorize?${query}`;
  }

  async complete(input: {
    flow: Pick<ProductFederationFlow, 'flowToken'>;
    code: string;
    returnedState: string;
  }): Promise<ProductLoginResult> {
    try {
      const flowToken = flowTokenSchema.parse(input.flow.flowToken);
      const code = codeSchema.parse(input.code);
      const returnedState = stateSchema.parse(input.returnedState);
      const flowHash = hashOpaqueToken(flowToken);
      const flow = await this.repository.findFlow(flowHash);
      const returnedStateHash = createHash('sha256').update(returnedState, 'ascii').digest();
      if (!flow || flow.expiresAt.getTime() <= Date.now() || !hashesMatch(flow.stateHash, returnedStateHash)) {
        throw new ProductFederationError('Product login state is invalid or expired');
      }
      const { codeVerifier } = z.object({
        codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
      }).parse(openTokenResponse(flow.sealedVerifier, flowToken, returnedState));
      const idempotencyKey = `idem_${createHash('sha256').update(flowToken, 'utf8').digest('base64url')}`;
      const token = await this.identityGateway.exchangeAuthorizationCode({
        grantType: 'authorization_code',
        clientId: flow.clientId,
        redirectUri: flow.redirectUri,
        code,
        codeVerifier,
        idempotencyKey,
      });
      const profile = profileSchema.parse(await this.identityGateway.getUserInfo(token.accessToken));
      if (profile.sub !== token.subject) throw new ProductFederationError();

      const sessionToken = `ps_${createOpaqueToken()}`;
      const expiresAt = new Date(Date.now() + PRODUCT_SESSION_TTL_MS);
      const result: ProductLoginResult = {
        member: {
          memberId: randomUUID(),
          clientId: flow.clientId,
          subject: profile.sub,
          cardId: profile.card_id,
          principalType: profile.principal_type,
          displayName: profile.display_name,
          handle: profile.handle,
        },
        sessionToken,
        expiresAt: expiresAt.toISOString(),
      };
      return await this.repository.completeFlow({
        flowHash,
        memberId: result.member.memberId,
        sessionHash: hashOpaqueToken(sessionToken),
        sessionExpiresAt: expiresAt,
        identity: {
          clientId: result.member.clientId,
          subject: result.member.subject,
          cardId: result.member.cardId,
          principalType: result.member.principalType,
          displayName: result.member.displayName,
          handle: result.member.handle,
        },
        result,
        recoverySecret: `${code}\0${codeVerifier}`,
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof ProductFederationError) throw error;
      throw new ProductFederationError();
    }
  }

  resolveSession(sessionToken: string) {
    const token = z.string().regex(/^ps_[A-Za-z0-9_-]{43}$/).parse(sessionToken);
    return this.repository.findActiveSession(hashOpaqueToken(token));
  }
}
