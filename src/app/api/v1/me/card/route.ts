import { authErrorResponse, json } from '@/server/authentication/auth-route';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { readSessionToken } from '@/server/authentication/http-auth';
import { AuthenticationStateError } from '@/server/authentication/errors';
import { getIdentityService } from '@/server/identity';

export const dynamic = 'force-dynamic';

type PrivateCardRouteDependencies = {
  resolveSession(token: string): Promise<{ principalId: string } | null>;
  getPrivateCard(principalId: string): Promise<unknown>;
  listCredentials(principalId: string): Promise<Array<{
    credentialId: string;
    deviceType: string;
    backedUp: boolean;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }>>;
};

export function createPrivateCardRoute(dependencies: PrivateCardRouteDependencies) {
  return async function privateCardRoute(request: Request): Promise<Response> {
    try {
      const token = readSessionToken(request);
      const session = token ? await dependencies.resolveSession(token) : null;
      if (!session) return authErrorResponse(new AuthenticationStateError('Authentication is required'));
      const [card, credentials] = await Promise.all([
        dependencies.getPrivateCard(session.principalId),
        dependencies.listCredentials(session.principalId),
      ]);
      return json({
        card,
        credentials: credentials.map((credential) => ({
          credential_id: credential.credentialId,
          device_type: credential.deviceType,
          backed_up: credential.backedUp,
          created_at: credential.createdAt.toISOString(),
          last_used_at: credential.lastUsedAt?.toISOString() ?? null,
          revoked_at: credential.revokedAt?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}

export const GET = createPrivateCardRoute({
  resolveSession(token) {
    return getAuthenticationService().resolveSession(token);
  },
  getPrivateCard(principalId) {
    return getIdentityService().getPrivateCard(principalId);
  },
  listCredentials(principalId) {
    return getAuthenticationService().listCredentials(principalId);
  },
});
