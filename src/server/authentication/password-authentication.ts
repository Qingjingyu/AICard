import { PasswordAuthenticationService } from '@/server/authentication/password-authentication-service';
import { getServerConfig } from '@/server/config';
import { PostgresAuthenticationRepository } from '@/server/postgres/authentication-repository';
import { createPostgresPool } from '@/server/postgres/pool';

let passwordAuthenticationService: PasswordAuthenticationService | undefined;

export function getPasswordAuthenticationService(): PasswordAuthenticationService {
  if (passwordAuthenticationService) return passwordAuthenticationService;
  const config = getServerConfig();
  passwordAuthenticationService = new PasswordAuthenticationService(
    new PostgresAuthenticationRepository(createPostgresPool(config.databaseUrl)),
  );
  return passwordAuthenticationService;
}
