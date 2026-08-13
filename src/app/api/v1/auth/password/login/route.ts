import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  authErrorResponse,
  json,
  requestId,
  setSessionCookies,
} from '@/server/authentication/auth-route';
import { AuthenticationStateError } from '@/server/authentication/errors';
import type { PasswordAuthenticationService } from '@/server/authentication/password-authentication-service';
import { getPasswordAuthenticationService } from '@/server/authentication/password-authentication';
import { assertMutationOrigin, readSessionToken } from '@/server/authentication/http-auth';
import { getServerConfig, type ServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  identifier: z.string().trim().min(3).max(64),
  password: z.string().max(128),
});

type PasswordLoginRouteDependencies = {
  login: PasswordAuthenticationService['login'];
  beforeRequest(identifier: string): Promise<void>;
  config: Pick<ServerConfig, 'nodeEnv' | 'appOrigin'>;
};

export function createPasswordLoginRoute(dependencies: PasswordLoginRouteDependencies) {
  return async function passwordLoginRoute(request: Request): Promise<Response> {
    const id = requestId();
    try {
      assertMutationOrigin(request, dependencies.config.appOrigin);
      const input = inputSchema.parse(await request.json());
      await dependencies.beforeRequest(input.identifier);
      const result = await dependencies.login({
        ...input,
        previousSessionToken: readSessionToken(request),
        requestId: id,
      });
      const response = json({
        card: {
          card_id: result.card.cardId,
          handle: result.card.handle,
          display_name: result.card.displayName,
        },
      });
      setSessionCookies(response, result, dependencies.config);
      return response;
    } catch (error) {
      return authErrorResponse(error, id);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const service = getPasswordAuthenticationService();
  const config = getServerConfig();
  return createPasswordLoginRoute({
    login: service.login.bind(service),
    beforeRequest: async (identifier) => {
      const keyHash = createHash('sha256')
        .update(`password.authentication\0${identifier.trim().toLowerCase()}`, 'utf8')
        .digest();
      const limit = await service.consumeRateLimit({
        scope: 'password.authentication',
        keyHash,
        maxAttempts: 10,
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
