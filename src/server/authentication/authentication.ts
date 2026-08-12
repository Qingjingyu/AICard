import { AuthenticationService } from '@/server/authentication/authentication-service';
import { SimpleWebAuthnAdapter } from '@/server/authentication/webauthn-service';
import { getServerConfig } from '@/server/config';
import { PostgresAuthenticationRepository } from '@/server/postgres/authentication-repository';
import { createPostgresPool } from '@/server/postgres/pool';

let authenticationService: AuthenticationService | undefined;

export function getAuthenticationService(): AuthenticationService {
  if (authenticationService) return authenticationService;
  const config = getServerConfig();
  authenticationService = new AuthenticationService(
    new PostgresAuthenticationRepository(createPostgresPool(config.databaseUrl)),
    new SimpleWebAuthnAdapter(),
    config.webauthn,
  );
  return authenticationService;
}
