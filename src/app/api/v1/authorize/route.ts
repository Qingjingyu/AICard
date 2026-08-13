import { z } from 'zod';

import { publicCardLookupSchema } from '@/domain/identity/schemas';
import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { authorizationErrorResponse, authorizationJson } from '@/server/authorization/authorization-route';
import { enforceRateLimit, requestId, requireRequestSession } from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin, requireCsrf } from '@/server/authentication/http-auth';
import { getServerConfig } from '@/server/config';
import { PlatformAuthorizationError } from '@/server/authorization/errors';
import { getIdentityService } from '@/server/identity';

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

export async function POST(request: Request): Promise<Response> {
  const id = requestId();
  try {
    const config = getServerConfig();
    assertMutationOrigin(request, config.appOrigin);
    requireCsrf(request);
    const authentication = getAuthenticationService();
    const session = await requireRequestSession(request, authentication);
    const input = consentSchema.parse(await request.json());
    await enforceRateLimit(
      authentication,
      'platform_consent',
      `${session.principalId}:${input.request.clientId}`,
      20,
      60_000,
    );
    let subjectPrincipalId: string | undefined;
    if (input.request.principalType === 'ai' && input.decision === 'approve') {
      const controlled = await getIdentityService().listControlledCards(session.principalId);
      subjectPrincipalId = controlled.find((card) => card.cardId === input.subjectCardId)?.principalId;
      if (!subjectPrincipalId) throw new PlatformAuthorizationError();
    }
    const result = await getPlatformAuthorizationService().resolveConsent({
      principalId: session.principalId,
      subjectPrincipalId,
      decision: input.decision,
      request: input.request,
      requestId: id,
    });
    return authorizationJson({ redirect_url: result.redirectUrl });
  } catch (error) {
    return authorizationErrorResponse(error, id);
  }
}
