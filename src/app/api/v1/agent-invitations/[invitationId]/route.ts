import { getAgentEnrollmentService } from '@/server/agent-enrollment';
import { agentErrorResponse, agentJson } from '@/server/agent-enrollment-route';
import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { readBearerToken } from '@/server/authorization/authorization-route';
import { PlatformAccessTokenError, PlatformAuthorizationError } from '@/server/authorization/errors';
import {
  requestId,
  requireRecentVerification,
  requireRequestSession,
} from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin, requireCsrf } from '@/server/authentication/http-auth';
import { getServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
): Promise<Response> {
  const id = requestId();
  try {
    const config = getServerConfig();
    const bearer = readBearerToken(request);
    let controllerPrincipalId: string;
    if (bearer) {
      const authorization = await getPlatformAuthorizationService().authenticateAccessToken(bearer);
      if (authorization.identity.principalType !== 'human') {
        throw new PlatformAuthorizationError('Only a human owner can revoke Agent enrollment');
      }
      if (!authorization.scopes.includes('agent.enroll')) {
        throw new PlatformAuthorizationError('The access token does not allow Agent enrollment');
      }
      controllerPrincipalId = authorization.identity.principalId;
    } else {
      assertMutationOrigin(request, config.appOrigin);
      requireCsrf(request);
      const session = await requireRequestSession(request, getAuthenticationService());
      requireRecentVerification(session.verifiedAt);
      controllerPrincipalId = session.principalId;
    }
    if (!bearer && request.headers.has('authorization')) throw new PlatformAccessTokenError();
    const { invitationId } = await context.params;
    await getAgentEnrollmentService().revokeInvitation(controllerPrincipalId, invitationId);
    return agentJson({ revoked: true });
  } catch (error) {
    return agentErrorResponse(error, id);
  }
}
