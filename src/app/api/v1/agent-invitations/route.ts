import { getAgentEnrollmentService } from '@/server/agent-enrollment';
import { agentErrorResponse, agentJson } from '@/server/agent-enrollment-route';
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
    assertMutationOrigin(request, config.appOrigin);
    requireCsrf(request);
    const session = await requireRequestSession(request, getAuthenticationService());
    requireRecentVerification(session.verifiedAt);
    const invitation = await getAgentEnrollmentService().createInvitation(
      session.principalId,
      await request.json(),
    );
    return agentJson({
      invitationId: invitation.invitationId,
      expiresAt: invitation.expiresAt.toISOString(),
      instructions: invitation.instructions,
      card: {
        cardId: invitation.card.cardId,
        displayName: invitation.card.displayName,
        handle: invitation.card.handle,
      },
    }, 201);
  } catch (error) {
    return agentErrorResponse(error, id);
  }
}
