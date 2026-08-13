import { z } from 'zod';

import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import type { RawAuthorizationRequest } from '@/server/authorization/authorization-service';
import { authorizationErrorResponse, authorizationJson } from '@/server/authorization/authorization-route';
import { requestId } from '@/server/authentication/auth-route';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  response_type: z.string(),
  client_id: z.string(),
  redirect_uri: z.string(),
  scope: z.string(),
  state: z.string(),
  code_challenge: z.string(),
  code_challenge_method: z.string(),
  principal_type: z.string().optional(),
});

type FederationValidationDependencies = {
  validateRequest(request: RawAuthorizationRequest): Promise<unknown>;
};

export function createFederationValidationRoute(dependencies: FederationValidationDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const id = requestId();
    try {
      const input = requestSchema.parse(await request.json());
      await dependencies.validateRequest({
        responseType: input.response_type,
        clientId: input.client_id,
        redirectUri: input.redirect_uri,
        scope: input.scope,
        state: input.state,
        codeChallenge: input.code_challenge,
        codeChallengeMethod: input.code_challenge_method,
        principalType: input.principal_type,
      });
      return authorizationJson({ valid: true });
    } catch (error) {
      return authorizationErrorResponse(error, id);
    }
  };
}

export const POST = createFederationValidationRoute({
  validateRequest: (request) => getPlatformAuthorizationService().validateRequest(request),
});
