import { getServerConfig } from '@/server/config';
import { IdentityService } from '@/server/identity-service';
import { PostgresIdentityRepository } from '@/server/postgres/identity-repository';
import { createPostgresPool } from '@/server/postgres/pool';

let identityService: IdentityService | undefined;

export function getIdentityService(): IdentityService {
  if (identityService) return identityService;
  const config = getServerConfig();
  const pool = createPostgresPool(config.databaseUrl);
  identityService = new IdentityService(new PostgresIdentityRepository(pool));
  return identityService;
}
