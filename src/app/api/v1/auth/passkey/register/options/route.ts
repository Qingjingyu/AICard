import { z } from 'zod';

import { displayNameSchema, handleSchema } from '@/domain/identity/schemas';
import {
  authErrorResponse,
  enforceRateLimit,
  json,
  requireRecentVerification,
  resolveRequestSession,
} from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { assertMutationOrigin, requireCsrf } from '@/server/authentication/http-auth';
import { getServerConfig } from '@/server/config';

export const dynamic = 'force-dynamic';

const initialRegistrationSchema = z.object({
  displayName: displayNameSchema,
  handle: handleSchema,
});

export async function POST(request: Request): Promise<Response> {
  const service = getAuthenticationService();
  const config = getServerConfig();
  try {
    assertMutationOrigin(request, config.appOrigin);
    const session = await resolveRequestSession(request, service);
    if (session) {
      requireCsrf(request);
      requireRecentVerification(session.verifiedAt);
      await enforceRateLimit(service, 'passkey.add', session.principalId, 10, 5 * 60_000);
      return json(await service.beginAdditionalCredential(session.principalId));
    }

    const input = initialRegistrationSchema.parse(await request.json());
    await enforceRateLimit(service, 'passkey.registration', input.handle, 5, 5 * 60_000);
    return json(await service.beginInitialRegistration(input));
  } catch (error) {
    return authErrorResponse(error);
  }
}
