import { timingSafeEqual } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  AuthorizationClient,
  AuthorizationScope,
  ManageablePlatformGrantView,
  PlatformGrantView,
  PlatformTokenResponse,
} from '@/domain/authorization/types';
import type { IdentityRecord, PrincipalType } from '@/domain/identity/types';
import { PlatformAccessTokenError, PlatformAuthorizationError } from '@/server/authorization/errors';
import { openTokenResponse, sealTokenResponse } from '@/server/authorization/token-response-seal';

type ClientRow = {
  client_id: string;
  display_name: string;
  audience: string;
  redirect_uri: string;
  scopes: AuthorizationScope[];
};

type AuthorizationCodeRow = {
  grant_id: string;
  principal_id: string;
  code_challenge: string;
  scopes: AuthorizationScope[];
  expires_at: Date;
  consumed_at: Date | null;
  grant_status: 'active' | 'revoked';
  client_status: 'active' | 'disabled';
  audience: string;
  exchange_idempotency_hash: Buffer | null;
  exchange_response_ciphertext: Buffer | null;
  exchange_response_iv: Buffer | null;
  exchange_response_tag: Buffer | null;
};

type RefreshTokenRow = {
  family_id: string;
  grant_id: string;
  principal_id: string;
  subject: string;
  audience: string;
  scopes: AuthorizationScope[];
  generation: number;
  token_expires_at: Date;
  consumed_at: Date | null;
  token_revoked_at: Date | null;
  rotation_idempotency_hash: Buffer | null;
  rotation_response_ciphertext: Buffer | null;
  rotation_response_iv: Buffer | null;
  rotation_response_tag: Buffer | null;
  family_status: 'active' | 'revoked';
  family_expires_at: Date;
  grant_status: 'active' | 'revoked';
  client_status: 'active' | 'disabled';
};

function hashesMatch(left: Buffer | null, right: Buffer): boolean {
  return Boolean(left && left.length === right.length && timingSafeEqual(left, right));
}

type UserInfoRow = {
  subject: string;
  scopes: AuthorizationScope[];
  principal_id: string;
  principal_type: PrincipalType;
  card_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: IdentityRecord['status'];
  created_at: Date;
  updated_at: Date;
};

async function audit(client: PoolClient, input: {
  eventId: string;
  eventType: string;
  actorPrincipalId: string;
  targetId: string;
  result: 'succeeded' | 'denied';
  requestId?: string;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `insert into security_audit_events
      (event_id, event_type, actor_principal_id, target_type, target_id, result, request_id, metadata)
     values ($1, $2, $3, 'platform_client', $4, $5, $6, $7)`,
    [
      input.eventId,
      input.eventType,
      input.actorPrincipalId,
      input.targetId,
      input.result,
      input.requestId ?? null,
      input.metadata ?? {},
    ],
  );
}

async function revokeGrantMaterial(client: PoolClient, grantId: string): Promise<void> {
  await client.query(
    `update platform_grants
     set status = 'revoked', revoked_at = now(), updated_at = now()
     where grant_id = $1`,
    [grantId],
  );
  await client.query(
    `update platform_refresh_token_families
     set status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
     where grant_id = $1`,
    [grantId],
  );
  await client.query(
    `update platform_refresh_tokens rt
     set revoked_at = coalesce(rt.revoked_at, now())
     from platform_refresh_token_families f
     where rt.family_id = f.family_id and f.grant_id = $1`,
    [grantId],
  );
  await client.query(
    `update platform_access_tokens
     set revoked_at = coalesce(revoked_at, now())
     where grant_id = $1`,
    [grantId],
  );
}

export class PostgresPlatformAuthorizationRepository {
  constructor(private readonly pool: Pool) {}

  async findActiveClient(clientId: string, redirectUri: string): Promise<AuthorizationClient | null> {
    const result = await this.pool.query<ClientRow>(
      `select pc.client_id, pc.display_name, pc.audience, pr.redirect_uri,
              array_agg(ps.scope order by ps.scope)::text[] as scopes
       from platform_clients pc
       join platform_client_redirect_uris pr on pr.client_id = pc.client_id
       join platform_client_scopes ps on ps.client_id = pc.client_id
       where pc.client_id = $1 and pr.redirect_uri = $2 and pc.status = 'active'
       group by pc.client_id, pc.display_name, pc.audience, pr.redirect_uri`,
      [clientId, redirectUri],
    );
    const row = result.rows[0];
    return row ? {
      clientId: row.client_id,
      displayName: row.display_name,
      audience: row.audience,
      redirectUri: row.redirect_uri,
      scopes: row.scopes,
    } : null;
  }

  async recordDenial(input: {
    eventId: string;
    principalId: string;
    clientId: string;
    scopes: AuthorizationScope[];
    requestId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await audit(client, {
        eventId: input.eventId,
        eventType: 'platform.authorization.denied',
        actorPrincipalId: input.principalId,
        targetId: input.clientId,
        result: 'denied',
        requestId: input.requestId,
        metadata: { scopes: input.scopes },
      });
    } finally {
      client.release();
    }
  }

  async issueAuthorizationCode(input: {
    grantId: string;
    eventId: string;
    actorPrincipalId: string;
    principalId: string;
    principalType: PrincipalType;
    clientId: string;
    redirectUri: string;
    scopes: AuthorizationScope[];
    codeChallenge: string;
    codeHash: Buffer;
    expiresAt: Date;
    requestId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const grant = await client.query<{ grant_id: string }>(
        `insert into platform_grants (grant_id, client_id, principal_id, scopes)
         select $1, $2, target.principal_id, $4
         from principals target
         join ai_cards target_card on target_card.principal_id = target.principal_id
         where target.principal_id = $3
           and target.principal_type = $5
           and target_card.status = 'active'
           and (
             ($5 = 'human' and $6 = target.principal_id)
             or
             ($5 = 'ai' and exists (
               select 1
               from principal_controllers control
               join principals controller
                 on controller.principal_id = control.controller_principal_id
               join ai_cards controller_card
                 on controller_card.principal_id = controller.principal_id
               where control.controlled_principal_id = target.principal_id
                 and control.controller_principal_id = $6
                 and control.revoked_at is null
                 and controller.principal_type = 'human'
                 and controller_card.status = 'active'
             ))
           )
         on conflict (client_id, principal_id) do update
           set scopes = excluded.scopes, status = 'active', revoked_at = null, updated_at = now()
         returning grant_id`,
        [
          input.grantId,
          input.clientId,
          input.principalId,
          input.scopes,
          input.principalType,
          input.actorPrincipalId,
        ],
      );
      const grantId = grant.rows[0]?.grant_id;
      if (!grantId) throw new PlatformAuthorizationError();

      await client.query(
        `insert into authorization_codes
          (code_hash, grant_id, client_id, principal_id, redirect_uri, code_challenge, scopes, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.codeHash,
          grantId,
          input.clientId,
          input.principalId,
          input.redirectUri,
          input.codeChallenge,
          input.scopes,
          input.expiresAt,
        ],
      );
      await audit(client, {
        eventId: input.eventId,
        eventType: 'platform.authorization.approved',
        actorPrincipalId: input.actorPrincipalId,
        targetId: input.clientId,
        result: 'succeeded',
        requestId: input.requestId,
        metadata: {
          scopes: input.scopes,
          grant_id: grantId,
          subject_principal_id: input.principalId,
        },
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async exchangeAuthorizationCode(input: {
    codeHash: Buffer;
    clientId: string;
    redirectUri: string;
    expectedCodeChallenge: string;
    subjectCandidate: string;
    accessToken: string;
    tokenHash: Buffer;
    tokenExpiresAt: Date;
    refreshFamilyId: string;
    refreshToken: string;
    refreshTokenHash: Buffer;
    refreshFamilyExpiresAt: Date;
    idempotencyKey: string;
    idempotencyHash: Buffer;
    recoverySecret: string;
    eventId: string;
    requestId?: string;
  }): Promise<PlatformTokenResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<AuthorizationCodeRow>(
        `select ac.grant_id, ac.principal_id, ac.code_challenge, ac.scopes,
                ac.expires_at, ac.consumed_at, pg.status as grant_status,
                pc.status as client_status, pc.audience,
                ac.exchange_idempotency_hash, ac.exchange_response_ciphertext,
                ac.exchange_response_iv, ac.exchange_response_tag
         from authorization_codes ac
         join platform_grants pg on pg.grant_id = ac.grant_id
         join platform_clients pc on pc.client_id = ac.client_id
         join ai_cards card on card.principal_id = ac.principal_id and card.status = 'active'
         where ac.code_hash = $1 and ac.client_id = $2 and ac.redirect_uri = $3
         for update of ac`,
        [input.codeHash, input.clientId, input.redirectUri],
      );
      const code = result.rows[0];
      if (
        code?.consumed_at
        && code.code_challenge === input.expectedCodeChallenge
        && code.grant_status === 'active'
        && code.client_status === 'active'
        && hashesMatch(code.exchange_idempotency_hash, input.idempotencyHash)
        && code.exchange_response_ciphertext
        && code.exchange_response_iv
        && code.exchange_response_tag
      ) {
        const recovered = openTokenResponse<PlatformTokenResponse>({
          ciphertext: code.exchange_response_ciphertext,
          iv: code.exchange_response_iv,
          tag: code.exchange_response_tag,
        }, input.recoverySecret, input.idempotencyKey);
        await client.query('commit');
        return recovered;
      }
      if (
        !code
        || code.consumed_at
        || code.expires_at.getTime() <= Date.now()
        || code.grant_status !== 'active'
        || code.client_status !== 'active'
        || code.code_challenge !== input.expectedCodeChallenge
      ) {
        throw new PlatformAuthorizationError('Authorization code is invalid or expired');
      }

      const subjectResult = await client.query<{ subject: string }>(
        `insert into platform_subjects (client_id, principal_id, subject)
         values ($1, $2, $3)
         on conflict (client_id, principal_id) do update set client_id = excluded.client_id
         returning subject`,
        [input.clientId, code.principal_id, input.subjectCandidate],
      );
      const subject = subjectResult.rows[0]?.subject;
      if (!subject) throw new PlatformAuthorizationError();

      const includesRefresh = code.scopes.includes('offline_access');
      if (includesRefresh) {
        await client.query(
          `insert into platform_refresh_token_families
            (family_id, grant_id, client_id, principal_id, subject, audience, scopes, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            input.refreshFamilyId,
            code.grant_id,
            input.clientId,
            code.principal_id,
            subject,
            code.audience,
            code.scopes,
            input.refreshFamilyExpiresAt,
          ],
        );
        await client.query(
          `insert into platform_refresh_tokens (token_hash, family_id, generation, expires_at)
           values ($1, $2, 0, $3)`,
          [input.refreshTokenHash, input.refreshFamilyId, input.refreshFamilyExpiresAt],
        );
      }
      await client.query(
        `insert into platform_access_tokens
          (token_hash, grant_id, client_id, principal_id, subject, audience, scopes, expires_at, family_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.tokenHash,
          code.grant_id,
          input.clientId,
          code.principal_id,
          subject,
          code.audience,
          code.scopes,
          input.tokenExpiresAt,
          includesRefresh ? input.refreshFamilyId : null,
        ],
      );
      const response: PlatformTokenResponse = {
        accessToken: input.accessToken,
        tokenType: 'Bearer',
        expiresIn: 600,
        scope: code.scopes.join(' '),
        subject,
        audience: code.audience,
        ...(includesRefresh ? {
          refreshToken: input.refreshToken,
          refreshExpiresIn: Math.max(0, Math.floor((input.refreshFamilyExpiresAt.getTime() - Date.now()) / 1_000)),
        } : {}),
      };
      const sealed = sealTokenResponse(response, input.recoverySecret, input.idempotencyKey);
      await client.query(
        `update authorization_codes
         set consumed_at = now(), exchange_idempotency_hash = $2,
             exchange_response_ciphertext = $3, exchange_response_iv = $4,
             exchange_response_tag = $5
         where code_hash = $1`,
        [input.codeHash, input.idempotencyHash, sealed.ciphertext, sealed.iv, sealed.tag],
      );
      await audit(client, {
        eventId: input.eventId,
        eventType: 'platform.token.issued',
        actorPrincipalId: code.principal_id,
        targetId: input.clientId,
        result: 'succeeded',
        requestId: input.requestId,
        metadata: { scopes: code.scopes, audience: code.audience },
      });
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async rotateRefreshToken(input: {
    clientId: string;
    tokenHash: Buffer;
    recoverySecret: string;
    idempotencyKey: string;
    idempotencyHash: Buffer;
    nextAccessToken: string;
    nextAccessTokenHash: Buffer;
    nextAccessTokenExpiresAt: Date;
    nextRefreshToken: string;
    nextRefreshTokenHash: Buffer;
    eventId: string;
    requestId?: string;
  }): Promise<{ kind: 'issued'; response: PlatformTokenResponse } | { kind: 'reused' }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<RefreshTokenRow>(
        `select rt.family_id, f.grant_id, f.principal_id, f.subject, f.audience,
                f.scopes, rt.generation, rt.expires_at as token_expires_at,
                rt.consumed_at, rt.revoked_at as token_revoked_at,
                rt.rotation_idempotency_hash, rt.rotation_response_ciphertext,
                rt.rotation_response_iv, rt.rotation_response_tag,
                f.status as family_status, f.expires_at as family_expires_at,
                g.status as grant_status, pc.status as client_status
         from platform_refresh_tokens rt
         join platform_refresh_token_families f on f.family_id = rt.family_id
         join platform_grants g on g.grant_id = f.grant_id
         join platform_clients pc on pc.client_id = f.client_id
         join ai_cards card on card.principal_id = f.principal_id and card.status = 'active'
         where rt.token_hash = $1 and f.client_id = $2
         for update of rt, f`,
        [input.tokenHash, input.clientId],
      );
      const token = result.rows[0];
      if (!token) throw new PlatformAuthorizationError('Refresh token is invalid or expired');

      if (token.consumed_at) {
        if (
          token.family_status === 'active'
          && token.grant_status === 'active'
          && token.client_status === 'active'
          && hashesMatch(token.rotation_idempotency_hash, input.idempotencyHash)
          && token.rotation_response_ciphertext
          && token.rotation_response_iv
          && token.rotation_response_tag
        ) {
          const response = openTokenResponse<PlatformTokenResponse>({
            ciphertext: token.rotation_response_ciphertext,
            iv: token.rotation_response_iv,
            tag: token.rotation_response_tag,
          }, input.recoverySecret, input.idempotencyKey);
          await client.query('commit');
          return { kind: 'issued', response };
        }

        await client.query(
          `update platform_refresh_token_families
           set status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
           where family_id = $1`,
          [token.family_id],
        );
        await client.query(
          `update platform_refresh_tokens set revoked_at = coalesce(revoked_at, now()) where family_id = $1`,
          [token.family_id],
        );
        await client.query(
          `update platform_access_tokens set revoked_at = coalesce(revoked_at, now()) where family_id = $1`,
          [token.family_id],
        );
        await audit(client, {
          eventId: input.eventId,
          eventType: 'platform.refresh_token.reuse_detected',
          actorPrincipalId: token.principal_id,
          targetId: input.clientId,
          result: 'denied',
          requestId: input.requestId,
          metadata: { family_id: token.family_id },
        });
        await client.query('commit');
        return { kind: 'reused' };
      }

      if (
        token.token_revoked_at
        || token.token_expires_at.getTime() <= Date.now()
        || token.family_status !== 'active'
        || token.family_expires_at.getTime() <= Date.now()
        || token.grant_status !== 'active'
        || token.client_status !== 'active'
      ) {
        throw new PlatformAuthorizationError('Refresh token is invalid or expired');
      }

      await client.query(
        `insert into platform_refresh_tokens (token_hash, family_id, generation, expires_at)
         values ($1, $2, $3, $4)`,
        [input.nextRefreshTokenHash, token.family_id, token.generation + 1, token.family_expires_at],
      );
      await client.query(
        `insert into platform_access_tokens
          (token_hash, grant_id, client_id, principal_id, subject, audience, scopes, expires_at, family_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.nextAccessTokenHash,
          token.grant_id,
          input.clientId,
          token.principal_id,
          token.subject,
          token.audience,
          token.scopes,
          input.nextAccessTokenExpiresAt,
          token.family_id,
        ],
      );
      const response: PlatformTokenResponse = {
        accessToken: input.nextAccessToken,
        tokenType: 'Bearer',
        expiresIn: 600,
        scope: token.scopes.join(' '),
        subject: token.subject,
        audience: token.audience,
        refreshToken: input.nextRefreshToken,
        refreshExpiresIn: Math.max(0, Math.floor((token.family_expires_at.getTime() - Date.now()) / 1_000)),
      };
      const sealed = sealTokenResponse(response, input.recoverySecret, input.idempotencyKey);
      await client.query(
        `update platform_refresh_tokens
         set consumed_at = now(), replaced_by_hash = $2, rotation_idempotency_hash = $3,
             rotation_response_ciphertext = $4, rotation_response_iv = $5,
             rotation_response_tag = $6
         where token_hash = $1`,
        [
          input.tokenHash,
          input.nextRefreshTokenHash,
          input.idempotencyHash,
          sealed.ciphertext,
          sealed.iv,
          sealed.tag,
        ],
      );
      await audit(client, {
        eventId: input.eventId,
        eventType: 'platform.refresh_token.rotated',
        actorPrincipalId: token.principal_id,
        targetId: input.clientId,
        result: 'succeeded',
        requestId: input.requestId,
        metadata: { family_id: token.family_id, generation: token.generation + 1 },
      });
      await client.query('commit');
      return { kind: 'issued', response };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async listGrants(principalId: string): Promise<PlatformGrantView[]> {
    const result = await this.pool.query<{
      grant_id: string;
      client_id: string;
      display_name: string;
      audience: string;
      scopes: AuthorizationScope[];
      status: 'active' | 'revoked';
      created_at: Date;
      updated_at: Date;
      revoked_at: Date | null;
      last_used_at: Date | null;
    }>(
      `select g.grant_id, g.client_id, pc.display_name, pc.audience, g.scopes,
              g.status, g.created_at, g.updated_at, g.revoked_at,
              greatest(max(at.created_at), max(rt.created_at)) as last_used_at
       from platform_grants g
       join platform_clients pc on pc.client_id = g.client_id
       left join platform_access_tokens at on at.grant_id = g.grant_id
       left join platform_refresh_token_families f on f.grant_id = g.grant_id
       left join platform_refresh_tokens rt on rt.family_id = f.family_id
       where g.principal_id = $1
       group by g.grant_id, pc.client_id
       order by g.updated_at desc, g.created_at desc`,
      [principalId],
    );
    return result.rows.map((row) => ({
      grantId: row.grant_id,
      clientId: row.client_id,
      clientDisplayName: row.display_name,
      audience: row.audience,
      scopes: row.scopes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revokedAt: row.revoked_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  async listManageableGrants(actorPrincipalId: string): Promise<ManageablePlatformGrantView[]> {
    const result = await this.pool.query<{
      grant_id: string;
      client_id: string;
      display_name: string;
      audience: string;
      scopes: AuthorizationScope[];
      status: 'active' | 'revoked';
      created_at: Date;
      updated_at: Date;
      revoked_at: Date | null;
      last_used_at: Date | null;
      principal_type: PrincipalType;
      card_id: string;
      subject_display_name: string;
      handle: string;
    }>(
      `select g.grant_id, g.client_id, pc.display_name, pc.audience, g.scopes,
              g.status, g.created_at, g.updated_at, g.revoked_at,
              greatest(max(at.created_at), max(rt.created_at)) as last_used_at,
              subject.principal_type, card.card_id,
              card.display_name as subject_display_name, handle.handle
       from platform_grants g
       join platform_clients pc on pc.client_id = g.client_id
       join principals subject on subject.principal_id = g.principal_id
       join ai_cards card on card.principal_id = subject.principal_id
       join card_handles handle on handle.card_id = card.card_id and handle.is_current
       left join platform_access_tokens at on at.grant_id = g.grant_id
       left join platform_refresh_token_families f on f.grant_id = g.grant_id
       left join platform_refresh_tokens rt on rt.family_id = f.family_id
       where g.principal_id = $1
          or (
            subject.principal_type = 'ai'
            and exists (
              select 1
              from principal_controllers control
              join principals controller
                on controller.principal_id = control.controller_principal_id
               and controller.principal_type = 'human'
              join ai_cards controller_card
                on controller_card.principal_id = controller.principal_id
               and controller_card.status = 'active'
              where control.controlled_principal_id = g.principal_id
                and control.controller_principal_id = $1
                and control.revoked_at is null
            )
          )
       group by g.grant_id, pc.client_id, subject.principal_type,
                card.card_id, card.display_name, handle.handle
       order by case when g.principal_id = $1 then 0 else 1 end,
                card.display_name, card.card_id, g.updated_at desc, g.created_at desc`,
      [actorPrincipalId],
    );
    return result.rows.map((row) => ({
      grantId: row.grant_id,
      clientId: row.client_id,
      clientDisplayName: row.display_name,
      audience: row.audience,
      scopes: row.scopes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revokedAt: row.revoked_at,
      lastUsedAt: row.last_used_at,
      subject: {
        principalType: row.principal_type,
        cardId: row.card_id,
        displayName: row.subject_display_name,
        handle: row.handle,
      },
    }));
  }

  async revokeManageableGrant(input: {
    actorPrincipalId: string;
    grantId: string;
    eventId: string;
    requestId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{
        client_id: string;
        principal_id: string;
        status: 'active' | 'revoked';
      }>(
        `select g.client_id, g.principal_id, g.status
         from platform_grants g
         join principals subject on subject.principal_id = g.principal_id
         where g.grant_id = $1
           and (
             g.principal_id = $2
             or (
               subject.principal_type = 'ai'
               and exists (
                 select 1
                 from principal_controllers control
                 join principals controller
                   on controller.principal_id = control.controller_principal_id
                  and controller.principal_type = 'human'
                 join ai_cards controller_card
                   on controller_card.principal_id = controller.principal_id
                  and controller_card.status = 'active'
                 where control.controlled_principal_id = g.principal_id
                   and control.controller_principal_id = $2
                   and control.revoked_at is null
               )
             )
           )
         for update of g`,
        [input.grantId, input.actorPrincipalId],
      );
      const grant = result.rows[0];
      if (!grant) throw new PlatformAuthorizationError('Grant was not found');
      if (grant.status === 'revoked') {
        await client.query('commit');
        return;
      }

      await revokeGrantMaterial(client, input.grantId);
      await audit(client, {
        eventId: input.eventId,
        eventType: 'platform.grant.revoked',
        actorPrincipalId: input.actorPrincipalId,
        targetId: grant.client_id,
        result: 'succeeded',
        requestId: input.requestId,
        metadata: {
          grant_id: input.grantId,
          subject_principal_id: grant.principal_id,
        },
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeGrant(input: {
    principalId: string;
    grantId: string;
    eventId: string;
    requestId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ client_id: string; status: 'active' | 'revoked' }>(
        `select client_id, status from platform_grants
         where grant_id = $1 and principal_id = $2
         for update`,
        [input.grantId, input.principalId],
      );
      const grant = result.rows[0];
      if (!grant) throw new PlatformAuthorizationError('Grant was not found');
      if (grant.status === 'revoked') {
        await client.query('commit');
        return;
      }

      await revokeGrantMaterial(client, input.grantId);
      await audit(client, {
        eventId: input.eventId,
        eventType: 'platform.grant.revoked',
        actorPrincipalId: input.principalId,
        targetId: grant.client_id,
        result: 'succeeded',
        requestId: input.requestId,
        metadata: { grant_id: input.grantId },
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserInfo(tokenHash: Buffer): Promise<{ identity: IdentityRecord; subject: string; scopes: AuthorizationScope[] }> {
    const result = await this.pool.query<UserInfoRow>(
      `select pat.subject, pat.scopes, p.principal_id, p.principal_type,
              c.card_id, h.handle, c.display_name, c.avatar_url, c.bio,
              c.status, c.created_at, c.updated_at
       from platform_access_tokens pat
       join platform_grants pg on pg.grant_id = pat.grant_id and pg.status = 'active'
       join platform_clients pc on pc.client_id = pat.client_id and pc.status = 'active'
       join principals p on p.principal_id = pat.principal_id
       join ai_cards c on c.principal_id = p.principal_id and c.status = 'active'
       join card_handles h on h.card_id = c.card_id and h.is_current
       where pat.token_hash = $1 and pat.revoked_at is null and pat.expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) throw new PlatformAccessTokenError();
    return {
      subject: row.subject,
      scopes: row.scopes,
      identity: {
        principalId: row.principal_id,
        principalType: row.principal_type,
        cardId: row.card_id,
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        bio: row.bio,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  }
}
