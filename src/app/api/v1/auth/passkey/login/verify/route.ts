import { z } from 'zod';

import {
  authErrorResponse,
  json,
  requestId,
  resolveRequestSession,
  setSessionCookies,
} from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin } from '@/server/authentication/http-auth';
import { getServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

const verifySchema = z.object({
  challengeId: z.uuid(),
  response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
});

export async function POST(request: Request): Promise<Response> {
  const service = getAuthenticationService();
  const config = getServerConfig();
  const id = requestId();
  try {
    assertMutationOrigin(request, config.appOrigin);
    const current = await resolveRequestSession(request, service);
    const input = verifySchema.parse(await request.json());
    const result = await service.finishAuthentication({
      ...input,
      currentSessionToken: current?.token,
      requestId: id,
    });
    const response = json({ principal_id: result.principalId });
    setSessionCookies(response, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
    }, config);
    return response;
  } catch (error) {
    return authErrorResponse(error, id);
  }
}
