import { nodeChallengeSchema } from '@/domain/identity/agent-enrollment';
import { getAgentEnrollmentService } from '@/server/agent-enrollment';
import {
  agentErrorResponse,
  agentJson,
  requestRateLimitKey,
} from '@/server/agent-enrollment-route';
import { enforceRateLimit, requestId } from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const id = requestId();
  try {
    await enforceRateLimit(
      getAuthenticationService(),
      'agent-node-challenge',
      requestRateLimitKey(request),
      30,
      60_000,
    );
    const parsed = nodeChallengeSchema.parse(await request.json());
    const result = await getAgentEnrollmentService().createNodeChallenge(parsed.nodeId);
    return agentJson({
      challengeId: result.challengeId,
      challenge: result.challenge,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    return agentErrorResponse(error, id);
  }
}
