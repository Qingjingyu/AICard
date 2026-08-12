import {
  authErrorResponse,
  clearSessionCookies,
  json,
  requestId,
  requireRequestSession,
} from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin, requireCsrf } from '@/server/authentication/http-auth';
import { getServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const service = getAuthenticationService();
  const config = getServerConfig();
  const id = requestId();
  try {
    assertMutationOrigin(request, config.appOrigin);
    requireCsrf(request);
    const session = await requireRequestSession(request, service);
    await service.revokeSession(session.token, id);
    const response = json({ logged_out: true });
    clearSessionCookies(response, config);
    return response;
  } catch (error) {
    return authErrorResponse(error, id);
  }
}
