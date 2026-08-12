import type { AgentEnrollmentService } from '@/server/agent-enrollment-service';
import { getAgentEnrollmentService } from '@/server/agent-enrollment';
import { requestRateLimitKey } from '@/server/agent-enrollment-route';
import {
  authorizationErrorResponse,
  authorizationJson,
  readBearerToken,
} from '@/server/authorization/authorization-route';
import { PlatformAccessTokenError } from '@/server/authorization/errors';
import { enforceRateLimit, requestId } from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';

export const dynamic = 'force-dynamic';

type RuntimeIntrospectionDependencies = {
  beforeRequest(request: Request): Promise<void>;
  introspectRuntimeToken: AgentEnrollmentService['introspectRuntimeToken'];
};

export function createAgentRuntimeIntrospectionRoute(
  dependencies: RuntimeIntrospectionDependencies,
) {
  return async function introspect(request: Request): Promise<Response> {
    const id = requestId();
    try {
      await dependencies.beforeRequest(request);
      const accessToken = readBearerToken(request);
      if (!accessToken) {
        throw new PlatformAccessTokenError('Agent runtime token is invalid or expired');
      }
      const session = await dependencies.introspectRuntimeToken(accessToken);
      return authorizationJson({
        active: session.active,
        sub: session.subject,
        node_id: session.nodeId,
        client_id: session.clientId,
        audience: session.audience,
        scope: session.scope,
        expires_at: session.expiresAt.toISOString(),
      });
    } catch (error) {
      return authorizationErrorResponse(error, id);
    }
  };
}

const introspect = createAgentRuntimeIntrospectionRoute({
  beforeRequest: async (request) => {
    await enforceRateLimit(
      getAuthenticationService(),
      'agent-runtime-introspect',
      requestRateLimitKey(request),
      120,
      60_000,
    );
  },
  introspectRuntimeToken: (accessToken) => (
    getAgentEnrollmentService().introspectRuntimeToken(accessToken)
  ),
});

export async function POST(request: Request): Promise<Response> {
  return introspect(request);
}
