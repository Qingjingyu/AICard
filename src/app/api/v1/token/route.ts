import { z } from 'zod';

import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { authorizationErrorResponse, authorizationJson } from '@/server/authorization/authorization-route';
import { PlatformAuthorizationError } from '@/server/authorization/errors';
import { requestRateLimitKey } from '@/server/agent-enrollment-route';
import { enforceRateLimit, requestId } from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';

export const dynamic = 'force-dynamic';

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    client_id: z.string(),
    redirect_uri: z.string(),
    code: z.string(),
    code_verifier: z.string(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    client_id: z.string(),
    refresh_token: z.string(),
  }),
]);

async function readTokenBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(await request.text()));
  }
  return request.json();
}

export async function POST(request: Request): Promise<Response> {
  const id = requestId();
  try {
    const input = tokenSchema.parse(await readTokenBody(request));
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) throw new PlatformAuthorizationError('Idempotency-Key is required');
    await enforceRateLimit(
      getAuthenticationService(),
      'platform_token',
      `${input.client_id}:${requestRateLimitKey(request)}`,
      30,
      60_000,
    );
    const authorization = getPlatformAuthorizationService();
    const token = input.grant_type === 'authorization_code'
      ? await authorization.exchangeAuthorizationCode({
        grantType: input.grant_type,
        clientId: input.client_id,
        redirectUri: input.redirect_uri,
        code: input.code,
        codeVerifier: input.code_verifier,
        idempotencyKey,
        requestId: id,
      })
      : await authorization.exchangeRefreshToken({
        grantType: input.grant_type,
        clientId: input.client_id,
        refreshToken: input.refresh_token,
        idempotencyKey,
        requestId: id,
      });
    return authorizationJson({
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_in: token.expiresIn,
      scope: token.scope,
      sub: token.subject,
      ...(token.refreshToken ? {
        refresh_token: token.refreshToken,
        refresh_expires_in: token.refreshExpiresIn,
      } : {}),
    });
  } catch (error) {
    return authorizationErrorResponse(error, id);
  }
}
