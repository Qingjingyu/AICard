import type { Pool, PoolClient } from 'pg';

import { createCardId, createPrincipalId } from '@/domain/identity/ids';
import type { IdentityRecord } from '@/domain/identity/types';
import { AuthenticationStateError } from '@/server/authentication/errors';

export type ChallengePurpose = 'registration' | 'authentication';

export type ConsumedChallenge = {
  challengeId: string;
  challengeHash: Buffer;
  purpose: ChallengePurpose;
  principalId: string | null;
  pendingDisplayName: string | null;
  pendingHandle: string | null;
  webauthnUserId: string | null;
};

export type ActiveSession = {
  principalId: string;
  createdAt: Date;
  expiresAt: Date;
  verifiedAt: Date;
};

export type StoredCredential = {
  credentialId: string;
  principalId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type CredentialInput = {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
};

type ChallengeRow = {
  challenge_id: string;
  challenge_hash: Buffer;
  purpose: ChallengePurpose;
  principal_id: string | null;
  pending_display_name: string | null;
  pending_handle: string | null;
  webauthn_user_id: string | null;
};

type CredentialRow = {
  credential_id: string;
  principal_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: boolean;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

function mapCredential(row: CredentialRow): StoredCredential {
  return {
    credentialId: row.credential_id,
    principalId: row.principal_id,
    publicKey: new Uint8Array(row.public_key),
    counter: Number(row.counter),
    transports: row.transports,
    deviceType: row.device_type,
    backedUp: row.backed_up,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

async function insertCredential(
  client: PoolClient,
  principalId: string,
  credential: CredentialInput,
): Promise<void> {
  await client.query(
    `insert into webauthn_credentials (
       credential_id, principal_id, public_key, counter, transports, device_type, backed_up
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      credential.id,
      principalId,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports,
      credential.deviceType,
      credential.backedUp,
    ],
  );
}

async function insertAuditEvent(
  client: PoolClient,
  input: {
    eventType: string;
    principalId: string | null;
    targetType: string;
    targetId?: string;
    result: 'succeeded' | 'failed' | 'denied';
    requestId?: string;
  },
): Promise<void> {
  await client.query(
    `insert into security_audit_events (
       event_id, event_type, actor_principal_id, target_type, target_id, result, request_id
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      createPrincipalId(),
      input.eventType,
      input.principalId,
      input.targetType,
      input.targetId ?? null,
      input.result,
      input.requestId ?? null,
    ],
  );
}

export class PostgresAuthenticationRepository {
  constructor(private readonly pool: Pool) {}

  async issueChallenge(input: {
    purpose: ChallengePurpose;
    challengeHash: Buffer;
    expiresAt: Date;
    principalId?: string;
    pendingDisplayName?: string;
    pendingHandle?: string;
    webauthnUserId?: string;
  }): Promise<{ challengeId: string }> {
    const challengeId = createPrincipalId();
    await this.pool.query(
      `insert into auth_challenges (
         challenge_id, purpose, challenge_hash, expires_at, principal_id,
         pending_display_name, pending_handle, webauthn_user_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        challengeId,
        input.purpose,
        input.challengeHash,
        input.expiresAt,
        input.principalId ?? null,
        input.pendingDisplayName ?? null,
        input.pendingHandle ?? null,
        input.webauthnUserId ?? null,
      ],
    );
    return { challengeId };
  }

  async consumeChallenge(
    challengeId: string,
    purpose: ChallengePurpose,
  ): Promise<ConsumedChallenge | null> {
    const result = await this.pool.query<ChallengeRow>(
      `update auth_challenges
       set consumed_at = now()
       where challenge_id = $1
         and purpose = $2
         and consumed_at is null
         and expires_at > now()
       returning challenge_id, challenge_hash, purpose, principal_id,
         pending_display_name, pending_handle, webauthn_user_id`,
      [challengeId, purpose],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      challengeId: row.challenge_id,
      challengeHash: row.challenge_hash,
      purpose: row.purpose,
      principalId: row.principal_id,
      pendingDisplayName: row.pending_display_name,
      pendingHandle: row.pending_handle,
      webauthnUserId: row.webauthn_user_id,
    };
  }

  async createSession(input: {
    principalId: string;
    sessionHash: Buffer;
    expiresAt: Date;
    verifiedAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into auth_sessions (session_hash, principal_id, expires_at, verified_at)
       values ($1, $2, $3, $4)`,
      [input.sessionHash, input.principalId, input.expiresAt, input.verifiedAt],
    );
  }

  async findActiveSession(sessionHash: Buffer): Promise<ActiveSession | null> {
    const result = await this.pool.query<{
      principal_id: string;
      created_at: Date;
      expires_at: Date;
      verified_at: Date;
    }>(
      `select principal_id, created_at, expires_at, verified_at
       from auth_sessions
       where session_hash = $1 and revoked_at is null and expires_at > now()`,
      [sessionHash],
    );
    const row = result.rows[0];
    return row ? {
      principalId: row.principal_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      verifiedAt: row.verified_at,
    } : null;
  }

  async revokeSession(sessionHash: Buffer, requestId?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const revoked = await client.query<{ principal_id: string }>(
        `update auth_sessions set revoked_at = coalesce(revoked_at, now())
         where session_hash = $1
         returning principal_id`,
        [sessionHash],
      );
      const principalId = revoked.rows[0]?.principal_id;
      if (principalId) {
        await insertAuditEvent(client, {
          eventType: 'session.revoked',
          principalId,
          targetType: 'session',
          result: 'succeeded',
          requestId,
        });
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeRateLimit(input: {
    scope: string;
    keyHash: Buffer;
    maxAttempts: number;
    windowMs: number;
    now?: Date;
  }): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
    const now = input.now ?? new Date();
    const result = await this.pool.query<{ attempts: number; window_started_at: Date }>(
      `insert into auth_rate_limits (scope, key_hash, window_started_at, attempts)
       values ($1, $2, $3, 1)
       on conflict (scope, key_hash) do update set
         attempts = case
           when auth_rate_limits.window_started_at <= $3 - ($4::bigint * interval '1 millisecond')
             then 1
           else auth_rate_limits.attempts + 1
         end,
         window_started_at = case
           when auth_rate_limits.window_started_at <= $3 - ($4::bigint * interval '1 millisecond')
             then $3
           else auth_rate_limits.window_started_at
         end
       returning attempts, window_started_at`,
      [input.scope, input.keyHash, now, input.windowMs],
    );
    const row = result.rows[0];
    if (!row) throw new AuthenticationStateError('Rate limit state was not returned');
    const allowed = row.attempts <= input.maxAttempts;
    const retryAt = row.window_started_at.getTime() + input.windowMs;
    return {
      allowed,
      remaining: Math.max(0, input.maxAttempts - row.attempts),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((retryAt - now.getTime()) / 1_000)),
    };
  }

  async completeInitialRegistration(input: {
    displayName: string;
    handle: string;
    webauthnUserId: string;
    credential: CredentialInput;
    sessionHash: Buffer;
    sessionExpiresAt: Date;
    verifiedAt: Date;
    requestId?: string;
  }): Promise<IdentityRecord> {
    const client = await this.pool.connect();
    const principalId = createPrincipalId();
    const cardId = createCardId();

    try {
      await client.query('begin');
      await client.query(
        'insert into principals (principal_id, principal_type) values ($1, $2)',
        [principalId, 'human'],
      );
      const cardResult = await client.query<{ created_at: Date; updated_at: Date }>(
        `insert into ai_cards (card_id, principal_id, display_name)
         values ($1, $2, $3)
         returning created_at, updated_at`,
        [cardId, principalId, input.displayName],
      );
      await client.query(
        'insert into card_handles (handle, card_id) values ($1, $2)',
        [input.handle, cardId],
      );
      await client.query(
        'insert into principal_auth_profiles (principal_id, webauthn_user_id) values ($1, $2)',
        [principalId, input.webauthnUserId],
      );
      await insertCredential(client, principalId, input.credential);
      await client.query(
        `insert into auth_sessions (session_hash, principal_id, expires_at, verified_at)
         values ($1, $2, $3, $4)`,
        [input.sessionHash, principalId, input.sessionExpiresAt, input.verifiedAt],
      );
      await insertAuditEvent(client, {
        eventType: 'passkey.registered',
        principalId,
        targetType: 'credential',
        targetId: input.credential.id,
        result: 'succeeded',
        requestId: input.requestId,
      });
      await client.query('commit');
      const timestamps = cardResult.rows[0];
      if (!timestamps) throw new AuthenticationStateError('Registration did not return Card data');
      return {
        principalId,
        principalType: 'human',
        cardId,
        handle: input.handle,
        displayName: input.displayName,
        avatarUrl: null,
        bio: null,
        status: 'active',
        createdAt: timestamps.created_at,
        updatedAt: timestamps.updated_at,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async findAuthProfile(principalId: string): Promise<{ webauthnUserId: string } | null> {
    const result = await this.pool.query<{ webauthn_user_id: string }>(
      'select webauthn_user_id from principal_auth_profiles where principal_id = $1',
      [principalId],
    );
    return result.rows[0] ? { webauthnUserId: result.rows[0].webauthn_user_id } : null;
  }

  async findIdentityByPrincipalId(principalId: string): Promise<IdentityRecord | null> {
    const result = await this.pool.query<{
      principal_id: string;
      principal_type: 'human' | 'ai';
      card_id: string;
      handle: string;
      display_name: string;
      avatar_url: string | null;
      bio: string | null;
      status: 'active' | 'suspended' | 'retired';
      created_at: Date;
      updated_at: Date;
    }>(
      `select p.principal_id, p.principal_type, c.card_id, h.handle, c.display_name,
         c.avatar_url, c.bio, c.status, c.created_at, c.updated_at
       from principals p
       join ai_cards c on c.principal_id = p.principal_id
       join card_handles h on h.card_id = c.card_id and h.is_current
       where p.principal_id = $1`,
      [principalId],
    );
    const row = result.rows[0];
    return row ? {
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
    } : null;
  }

  async findActiveCredential(credentialId: string): Promise<StoredCredential | null> {
    const result = await this.pool.query<CredentialRow>(
      `select credential_id, principal_id, public_key, counter, transports, device_type,
         backed_up, created_at, last_used_at, revoked_at
       from webauthn_credentials
       where credential_id = $1 and revoked_at is null`,
      [credentialId],
    );
    return result.rows[0] ? mapCredential(result.rows[0]) : null;
  }

  async listCredentials(principalId: string): Promise<StoredCredential[]> {
    const result = await this.pool.query<CredentialRow>(
      `select credential_id, principal_id, public_key, counter, transports, device_type,
         backed_up, created_at, last_used_at, revoked_at
       from webauthn_credentials
       where principal_id = $1
       order by created_at, credential_id`,
      [principalId],
    );
    return result.rows.map(mapCredential);
  }

  async addCredential(input: {
    principalId: string;
    credential: CredentialInput;
    requestId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await insertCredential(client, input.principalId, input.credential);
      await insertAuditEvent(client, {
        eventType: 'passkey.added',
        principalId: input.principalId,
        targetType: 'credential',
        targetId: input.credential.id,
        result: 'succeeded',
        requestId: input.requestId,
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeAuthentication(input: {
    credential: StoredCredential;
    newCounter: number;
    previousSessionHash?: Buffer;
    sessionHash: Buffer;
    sessionExpiresAt: Date;
    verifiedAt: Date;
    requestId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const counterUpdate = await client.query(
        `update webauthn_credentials
         set counter = $1, last_used_at = now()
         where credential_id = $2 and revoked_at is null and counter = $3`,
        [input.newCounter, input.credential.credentialId, input.credential.counter],
      );
      if (counterUpdate.rowCount !== 1) {
        throw new AuthenticationStateError('Credential state changed during authentication');
      }
      if (input.previousSessionHash) {
        await client.query(
          'update auth_sessions set revoked_at = coalesce(revoked_at, now()) where session_hash = $1',
          [input.previousSessionHash],
        );
      }
      await client.query(
        `insert into auth_sessions (session_hash, principal_id, expires_at, verified_at)
         values ($1, $2, $3, $4)`,
        [
          input.sessionHash,
          input.credential.principalId,
          input.sessionExpiresAt,
          input.verifiedAt,
        ],
      );
      await insertAuditEvent(client, {
        eventType: 'passkey.authenticated',
        principalId: input.credential.principalId,
        targetType: 'credential',
        targetId: input.credential.credentialId,
        result: 'succeeded',
        requestId: input.requestId,
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeCredential(principalId: string, credentialId: string, requestId?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const active = await client.query<{ credential_id: string }>(
        `select credential_id from webauthn_credentials
         where principal_id = $1 and revoked_at is null
         order by credential_id
         for update`,
        [principalId],
      );
      if (!active.rows.some((row) => row.credential_id === credentialId)) {
        throw new AuthenticationStateError('Credential is not active for this Principal');
      }
      if (active.rowCount === 1) {
        throw new AuthenticationStateError('The last active credential cannot be revoked');
      }
      await client.query(
        'update webauthn_credentials set revoked_at = now() where credential_id = $1',
        [credentialId],
      );
      await insertAuditEvent(client, {
        eventType: 'passkey.revoked',
        principalId,
        targetType: 'credential',
        targetId: credentialId,
        result: 'succeeded',
        requestId,
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
