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
      'agent-claim-status',
      requestRateLimitKey(request),
      30,
      60_000,
    );
    return agentJson(await getAgentEnrollmentService().getClaimStatus(await request.json()));
  } catch (error) {
    return agentErrorResponse(error, id);
  }
}
