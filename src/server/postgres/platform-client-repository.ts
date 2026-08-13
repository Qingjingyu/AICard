import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import type { AuthorizationScope } from '@/domain/authorization/types';
import { PlatformClientRegistrationConflictError } from '@/server/authorization/platform-client-registration-service';

type Registration = {
  clientId: string;
  displayName: string;
  audience: string;
  redirectUris: string[];
  scopes: AuthorizationScope[];
};

type ClientRow = {
  client_id: string;
  display_name: string;
  audience: string;
  status: string;
  redirect_uris: string[];
  scopes: AuthorizationScope[];
};

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class PostgresPlatformClientRepository {
  constructor(private readonly pool: Pool) {}

  async register(input: Registration): Promise<{ created: boolean; clientId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `platform-client:${input.clientId}`,
      ]);
      const existing = await client.query<ClientRow>(
        `select clients.client_id, clients.display_name, clients.audience, clients.status,
                coalesce(array_agg(distinct redirects.redirect_uri order by redirects.redirect_uri)
                  filter (where redirects.redirect_uri is not null), '{}') as redirect_uris,
                coalesce(array_agg(distinct scopes.scope order by scopes.scope)
                  filter (where scopes.scope is not null), '{}') as scopes
         from platform_clients clients
         left join platform_client_redirect_uris redirects using (client_id)
         left join platform_client_scopes scopes using (client_id)
         where clients.client_id = $1
         group by clients.client_id, clients.display_name, clients.audience, clients.status`,
        [input.clientId],
      );
      const row = existing.rows[0];
      if (row) {
        const exact = row.display_name === input.displayName
          && row.audience === input.audience
          && row.status === 'active'
          && sameValues(row.redirect_uris, input.redirectUris)
          && sameValues(row.scopes, input.scopes);
        if (!exact) throw new PlatformClientRegistrationConflictError();
        await client.query('commit');
        return { created: false, clientId: input.clientId };
      }

      try {
        await client.query(
          `insert into platform_clients (client_id, display_name, audience)
           values ($1, $2, $3)`,
          [input.clientId, input.displayName, input.audience],
        );
        for (const redirectUri of input.redirectUris) {
          await client.query(
            `insert into platform_client_redirect_uris (client_id, redirect_uri)
             values ($1, $2)`,
            [input.clientId, redirectUri],
          );
        }
        for (const scope of input.scopes) {
          await client.query(
            `insert into platform_client_scopes (client_id, scope) values ($1, $2)`,
            [input.clientId, scope],
          );
        }
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new PlatformClientRegistrationConflictError();
        }
        throw error;
      }
      await client.query(
        `insert into security_audit_events
          (event_id, event_type, target_type, target_id, result, metadata)
         values ($1, 'platform.client.registered', 'platform_client', $2, 'succeeded', $3::jsonb)`,
        [randomUUID(), input.clientId, JSON.stringify({
          audience: input.audience,
          redirectUris: input.redirectUris,
          scopes: input.scopes,
        })],
      );
      await client.query('commit');
      return { created: true, clientId: input.clientId };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
