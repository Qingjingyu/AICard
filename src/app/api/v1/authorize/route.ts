import { createHash } from 'node:crypto';

import { z } from 'zod';

import { publicCardLookupSchema } from '@/domain/identity/schemas';
import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { authorizationErrorResponse, authorizationJson } from '@/server/authorization/authorization-route';
import type { PlatformAuthorizationService } from '@/server/authorization/authorization-service';
import { PlatformAuthorizationError } from '@/server/authorization/errors';
import { requestId } from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import type { AuthenticationService } from '@/server/authentication/authentication-service';
import { AuthenticationStateError } from '@/server/authentication/errors';
import { readSessionToken, requireCsrf } from '@/server/authentication/http-auth';
import {
  assertTrustedProductMutationOrigin,
  createTrustedProductPreflight,
  withTrustedProductCors,
} from '@/server/authentication/trusted-product-cors';
import { getServerConfig, type ServerConfig } from '@/server/config';
import { getIdentityService } from '@/server/identity';
import type { IdentityService } from '@/server/identity-service';

export const dynamic = 'force-dynamic';

const consentSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  subjectCardId: publicCardLookupSchema.optional(),
  request: z.object({
    responseType: z.string(),
    clientId: z.string(),
    redirectUri: z.string(),
    scope: z.string(),
    state: z.string(),
    codeChallenge: z.string(),
    codeChallengeMethod: z.string(),
    principalType: z.string().optional(),
  }),
});

type PlatformAuthorizationRouteDependencies = {
  config: Pick<ServerConfig, 'appOrigin' | 'trustedProductOrigins'>;
  resolveSession: AuthenticationService['resolveSession'];
  consumeRateLimit: AuthenticationService['consumeRateLimit'];
  resolveConsent: PlatformAuthorizationService['resolveConsent'];
  listControlledCards: IdentityService['listControlledCards'];
};

export function createPlatformAuthorizationRoute(
  dependencies: PlatformAuthorizationRouteDependencies,
) {
  return async function platformAuthorizationRoute(request: Request): Promise<Response> {
    const id = requestId();
    let response: Response;
    try {
      assertTrustedProductMutationOrigin(request, dependencies.config);
      requireCsrf(request);
      const sessionToken = readSessionToken(request);
      const session = sessionToken ? await dependencies.resolveSession(sessionToken) : null;
      if (!session) throw new AuthenticationStateError('Authentication is required');

      const input = consentSchema.parse(await request.json());
      const keyHash = createHash('sha256')
        .update(`platform_consent\0${session.principalId}:${input.request.clientId}`, 'utf8')
        .digest();
      const limit = await dependencies.consumeRateLimit({
        scope: 'platform_consent',
        keyHash,
        maxAttempts: 20,
        windowMs: 60_000,
      });
      if (!limit.allowed) {
        const error = new AuthenticationStateError('Too many authentication attempts');
        Object.assign(error, { retryAfterSeconds: limit.retryAfterSeconds });
        throw error;
      }

      let subjectPrincipalId: string | undefined;
      if (input.request.principalType === 'ai' && input.decision === 'approve') {
        const controlled = await dependencies.listControlledCards(session.principalId);
        subjectPrincipalId = controlled.find(
          (card) => card.cardId === input.subjectCardId,
        )?.principalId;
        if (!subjectPrincipalId) throw new PlatformAuthorizationError();
      }
      const result = await dependencies.resolveConsent({
        principalId: session.principalId,
        subjectPrincipalId,
        decision: input.decision,
        request: input.request,
        requestId: id,
      });
      response = authorizationJson({ redirect_url: result.redirectUrl });
    } catch (error) {
      response = authorizationErrorResponse(error, id);
    }
    return withTrustedProductCors(request, response, dependencies.config);
  };
}

export function createPlatformAuthorizationOptionsRoute(
  config: Pick<ServerConfig, 'appOrigin' | 'trustedProductOrigins'>,
) {
  return function platformAuthorizationOptionsRoute(request: Request): Response {
    try {
      return createTrustedProductPreflight(request, config);
    } catch (error) {
      return withTrustedProductCors(request, authorizationErrorResponse(error), config);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig();
  const authentication = getAuthenticationService();
  const authorization = getPlatformAuthorizationService();
  const identity = getIdentityService();
  return createPlatformAuthorizationRoute({
    config,
    resolveSession: authentication.resolveSession.bind(authentication),
    consumeRateLimit: authentication.consumeRateLimit.bind(authentication),
    resolveConsent: authorization.resolveConsent.bind(authorization),
    listControlledCards: identity.listControlledCards.bind(identity),
  })(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return createPlatformAuthorizationOptionsRoute(getServerConfig())(request);
}
