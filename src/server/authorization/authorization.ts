import { PlatformAuthorizationService } from '@/server/authorization/authorization-service';
import { getServerConfig } from '@/server/config';
import { PostgresPlatformAuthorizationRepository } from '@/server/postgres/platform-authorization-repository';
import { createPostgresPool } from '@/server/postgres/pool';

let platformAuthorizationService: PlatformAuthorizationService | undefined;

export function getPlatformAuthorizationService(): PlatformAuthorizationService {
  if (platformAuthorizationService) return platformAuthorizationService;
  const config = getServerConfig();
  platformAuthorizationService = new PlatformAuthorizationService(
    new PostgresPlatformAuthorizationRepository(createPostgresPool(config.databaseUrl)),
  );
  return platformAuthorizationService;
}
