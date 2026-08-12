import {
  authErrorResponse,
  enforceRateLimit,
  json,
  resolveRequestSession,
} from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin, requireCsrf } from '@/server/authentication/http-auth';
import { getServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const service = getAuthenticationService();
  const config = getServerConfig();
  try {
    assertMutationOrigin(request, config.appOrigin);
    const session = await resolveRequestSession(request, service);
    if (session) requireCsrf(request);
    await enforceRateLimit(service, 'passkey.authentication', 'global', 100, 5 * 60_000);
    return json(await service.beginAuthentication(session?.principalId));
  } catch (error) {
    return authErrorResponse(error);
  }
}
