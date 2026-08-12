import {
  authErrorResponse,
  json,
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
  context: { params: Promise<{ credentialId: string }> },
): Promise<Response> {
  const service = getAuthenticationService();
  const config = getServerConfig();
  const id = requestId();
  try {
    assertMutationOrigin(request, config.appOrigin);
    requireCsrf(request);
    const session = await requireRequestSession(request, service);
    requireRecentVerification(session.verifiedAt);
    const { credentialId } = await context.params;
    await service.revokeCredential(session.principalId, credentialId, id);
    return json({ revoked: true });
  } catch (error) {
    return authErrorResponse(error, id);
  }
}
