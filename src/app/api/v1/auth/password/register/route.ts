import { createHash } from 'node:crypto';

import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { displayNameSchema, handleSchema } from '@/domain/identity/schemas';
import {
  authErrorResponse,
  json,
  requestId,
  setSessionCookies,
} from '@/server/authentication/auth-route';
import type { PasswordAuthenticationService } from '@/server/authentication/password-authentication-service';
import { getPasswordAuthenticationService } from '@/server/authentication/password-authentication';
import { AuthenticationStateError } from '@/server/authentication/errors';
import { passwordSchema } from '@/server/authentication/password-security';
import {
  assertTrustedProductMutationOrigin,
  createTrustedProductPreflight,
  withTrustedProductCors,
} from '@/server/authentication/trusted-product-cors';
import { getServerConfig, type ServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  clientId: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  displayName: displayNameSchema,
  handle: handleSchema,
  password: passwordSchema,
});
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

type PasswordRegistrationRouteDependencies = {
  register: PasswordAuthenticationService['register'];
  beforeRequest(key: string): Promise<void>;
  config: Pick<ServerConfig, 'nodeEnv' | 'appOrigin' | 'trustedProductOrigins'>;
};

export function createPasswordRegistrationRoute(
  dependencies: PasswordRegistrationRouteDependencies,
) {
  return async function passwordRegistrationRoute(request: Request): Promise<Response> {
    const id = requestId();
    let response: NextResponse;
    try {
      assertTrustedProductMutationOrigin(request, dependencies.config);
      const idempotencyKey = idempotencyKeySchema.parse(request.headers.get('idempotency-key'));
      const input = inputSchema.parse(await request.json());
      await dependencies.beforeRequest(
        createHash('sha256').update(`${input.clientId}\0${input.handle}`, 'utf8').digest('hex'),
      );
      const result = await dependencies.register({ ...input, idempotencyKey, requestId: id });
      response = json({
        card: {
          card_id: result.card.cardId,
          handle: result.card.handle,
          display_name: result.card.displayName,
        },
        replayed: result.replayed,
        csrf_token: result.csrfToken,
      }, result.replayed ? 200 : 201);
      setSessionCookies(response, result, dependencies.config);
    } catch (error) {
      response = authErrorResponse(error, id);
    }
    return withTrustedProductCors(request, response, dependencies.config);
  };
}

export function createPasswordRegistrationOptionsRoute(
  config: Pick<ServerConfig, 'appOrigin' | 'trustedProductOrigins'>,
) {
  return function passwordRegistrationOptionsRoute(request: Request): Response {
    try {
      return createTrustedProductPreflight(request, config);
    } catch (error) {
      return withTrustedProductCors(request, authErrorResponse(error), config);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const service = getPasswordAuthenticationService();
  const config = getServerConfig();
  return createPasswordRegistrationRoute({
    register: service.register.bind(service),
    beforeRequest: async (key) => {
      const keyHash = createHash('sha256').update(`password.registration\0${key}`, 'utf8').digest();
      const limit = await service.consumeRateLimit({
        scope: 'password.registration',
        keyHash,
        maxAttempts: 5,
        windowMs: 15 * 60_000,
      });
      if (!limit.allowed) {
        const error = new AuthenticationStateError('Too many authentication attempts');
        Object.assign(error, { retryAfterSeconds: limit.retryAfterSeconds });
        throw error;
      }
    },
    config,
  })(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return createPasswordRegistrationOptionsRoute(getServerConfig())(request);
}
