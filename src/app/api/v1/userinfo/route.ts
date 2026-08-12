import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import {
  authorizationErrorResponse,
  authorizationJson,
  readBearerToken,
} from '@/server/authorization/authorization-route';
import { PlatformAccessTokenError } from '@/server/authorization/errors';
import { requestId } from '@/server/authentication/auth-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const id = requestId();
  try {
    const accessToken = readBearerToken(request);
    if (!accessToken) throw new PlatformAccessTokenError();
    return authorizationJson(await getPlatformAuthorizationService().getUserInfo(accessToken));
  } catch (error) {
    return authorizationErrorResponse(error, id);
  }
}
