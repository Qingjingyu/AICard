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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
): Promise<Response> {
  const id = requestId();
  try {
    const config = getServerConfig();
    assertMutationOrigin(request, config.appOrigin);
    requireCsrf(request);
    const session = await requireRequestSession(request, getAuthenticationService());
    requireRecentVerification(session.verifiedAt);
    const { nodeId } = await context.params;
    await getAgentEnrollmentService().revokeNode(session.principalId, nodeId);
    return agentJson({ revoked: true });
  } catch (error) {
    return agentErrorResponse(error, id);
  }
}
