import { z } from 'zod';

import {
  authErrorResponse,
  json,
  requestId,
  resolveRequestSession,
  setSessionCookies,
} from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin, requireCsrf } from '@/server/authentication/http-auth';
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
    const session = await resolveRequestSession(request, service);
    if (session) requireCsrf(request);
    const input = verifySchema.parse(await request.json());
    const result = await service.finishRegistration({
      ...input,
      currentPrincipalId: session?.principalId,
      requestId: id,
    });
    const response = json({ card: result.card }, 201);
    if (result.sessionToken && result.csrfToken) {
      setSessionCookies(response, {
        sessionToken: result.sessionToken,
        csrfToken: result.csrfToken,
      }, config);
    }
    return response;
  } catch (error) {
    return authErrorResponse(error, id);
  }
}
