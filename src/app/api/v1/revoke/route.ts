import { z } from 'zod';

import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { authorizationErrorResponse, authorizationJson } from '@/server/authorization/authorization-route';
import {
  enforceRateLimit,
  requestId,
  requireRecentVerification,
  requireRequestSession,
} from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin, requireCsrf } from '@/server/authentication/http-auth';
import { getServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

const revokeSchema = z.object({ grantId: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  const id = requestId();
  try {
    const config = getServerConfig();
    assertMutationOrigin(request, config.appOrigin);
    requireCsrf(request);
    const authentication = getAuthenticationService();
    const session = await requireRequestSession(request, authentication);
    requireRecentVerification(session.verifiedAt);
    const input = revokeSchema.parse(await request.json());
    await enforceRateLimit(authentication, 'platform_revoke', session.principalId, 20, 60_000);
    await getPlatformAuthorizationService().revokeManageableGrant({
      actorPrincipalId: session.principalId,
      grantId: input.grantId,
      requestId: id,
    });
    return authorizationJson({ revoked: true });
  } catch (error) {
    return authorizationErrorResponse(error, id);
  }
}
