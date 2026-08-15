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

export async function POST(request: Request): Promise<Response> {
  const id = requestId();
  try {
    const config = getServerConfig();
    const bearer = readBearerToken(request);
    const body = await request.json() as Record<string, unknown>;
    let controllerPrincipalId: string;
    let invitationInput: Record<string, unknown> = body;
    if (bearer) {
      const authorization = await getPlatformAuthorizationService().authenticateAccessToken(bearer);
      if (authorization.identity.principalType !== 'human') {
        throw new PlatformAuthorizationError('Only a human owner can authorize Agent enrollment');
      }
      if (!authorization.scopes.includes('agent.enroll')) {
        throw new PlatformAuthorizationError('The access token does not allow Agent enrollment');
      }
      controllerPrincipalId = authorization.identity.principalId;
      invitationInput = { ...body, clientId: authorization.clientId };
    } else {
      assertMutationOrigin(request, config.appOrigin);
      requireCsrf(request);
      const session = await requireRequestSession(request, getAuthenticationService());
      requireRecentVerification(session.verifiedAt);
      controllerPrincipalId = session.principalId;
    }
    if (!bearer && request.headers.has('authorization')) throw new PlatformAccessTokenError();
    const invitation = await getAgentEnrollmentService().createInvitation(
      controllerPrincipalId,
      invitationInput,
    );
    return agentJson({
      invitationId: invitation.invitationId,
      expiresAt: invitation.expiresAt.toISOString(),
      instructions: invitation.instructions,
      identity: {
        cardId: invitation.identity.cardId,
        displayName: invitation.identity.displayName,
        handle: invitation.identity.handle,
      },
      claim: invitation.claim,
    }, 201);
  } catch (error) {
    return agentErrorResponse(error, id);
  }
}
