import type { Pool, PoolClient } from 'pg';

import { createPairwiseSubject, createPrincipalId } from '@/domain/identity/ids';
import type {
  CardStatus,
  ControllerSummary,
  HandleHistoryEntry,
  IdentityRecord,
  PrincipalType,
} from '@/domain/identity/types';
import {
  IdentityConflictError,
  IdentityNotFoundError,
  IdentityStateError,
} from '@/server/identity-errors';

type IdentityRow = {
  principal_id: string;
  principal_type: PrincipalType;
  card_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: CardStatus;
  created_at: Date;
  updated_at: Date;
};

type CreateIdentityRecord = {
  principalType: PrincipalType;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  controllerPrincipalId?: string;
};

const identitySelect = `
  select
    p.principal_id,
    p.principal_type,
    c.card_id,
    h.handle,
    c.display_name,
    c.avatar_url,
    c.bio,
    c.status,
    c.created_at,
    c.updated_at
  from principals p
  join ai_cards c on c.principal_id = p.principal_id
  join card_handles h on h.card_id = c.card_id and h.is_current
`;

function mapIdentity(row: IdentityRow): IdentityRecord {
  return {
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
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function requireVerifiedHumanController(
  client: PoolClient,
  controllerPrincipalId: string,
): Promise<void> {
  const result = await client.query<{ principal_type: PrincipalType; status: CardStatus }>(
    `select p.principal_type, c.status
     from principals p
     join ai_cards c on c.principal_id = p.principal_id
     where p.principal_id = $1
     for share`,
    [controllerPrincipalId],
  );
  const controller = result.rows[0];

  if (!controller || controller.principal_type !== 'human' || controller.status !== 'active') {
    throw new IdentityStateError('AI Card requires an active human controller');
  }
}

export class PostgresIdentityRepository {
  constructor(private readonly pool: Pool) {}

  async createIdentity(input: CreateIdentityRecord): Promise<IdentityRecord> {
    const client = await this.pool.connect();
    const principalId = createPrincipalId();

    try {
      await client.query('begin');
      if (input.principalType === 'ai') {
        if (!input.controllerPrincipalId) {
          throw new IdentityStateError('AI Card requires a human controller');
        }
        await requireVerifiedHumanController(client, input.controllerPrincipalId);
      }

      await client.query(
        'insert into principals (principal_id, principal_type) values ($1, $2)',
        [principalId, input.principalType],
      );
      const cardResult = await client.query<{
        card_id: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `insert into ai_cards
          (principal_id, display_name, avatar_url, bio)
         values ($1, $2, $3, $4)
         returning card_id, created_at, updated_at`,
        [principalId, input.displayName, input.avatarUrl ?? null, input.bio ?? null],
      );
      const card = cardResult.rows[0];
      if (!card) throw new Error('AI Card insert did not return identity data');
      await client.query(
        'insert into card_handles (handle, card_id) values ($1, $2)',
        [input.handle, card.card_id],
      );

      if (input.principalType === 'ai' && input.controllerPrincipalId) {
        await client.query(
          `insert into principal_controllers
            (controlled_principal_id, controller_principal_id)
           values ($1, $2)`,
          [principalId, input.controllerPrincipalId],
        );
      }

      await client.query('commit');
      return {
        principalId,
        principalType: input.principalType,
        cardId: card.card_id,
        handle: input.handle,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl ?? null,
        bio: input.bio ?? null,
        status: 'active',
        createdAt: card.created_at,
        updatedAt: card.updated_at,
      };
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) {
        throw new IdentityConflictError('Handle or permanent identifier is already reserved');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listControlledCards(controllerPrincipalId: string): Promise<IdentityRecord[]> {
    const result = await this.pool.query<IdentityRow>(
      `${identitySelect}
       join principal_controllers control
         on control.controlled_principal_id = p.principal_id
       join principals controller_principal
         on controller_principal.principal_id = control.controller_principal_id
        and controller_principal.principal_type = 'human'
       join ai_cards controller_card
         on controller_card.principal_id = controller_principal.principal_id
       where control.controller_principal_id = $1
         and control.revoked_at is null
         and controller_card.status = 'active'
         and p.principal_type = 'ai'
         and c.status = 'active'
       order by c.created_at, c.card_id`,
      [controllerPrincipalId],
    );
    return result.rows.map(mapIdentity);
  }

  async findByCardId(cardId: string): Promise<IdentityRecord | null> {
    const result = await this.pool.query<IdentityRow>(
      `${identitySelect}
       where c.card_id = coalesce(
         (select alias.card_id from ai_card_id_aliases alias where alias.old_card_id = $1),
         $1
       )`,
      [cardId],
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }

  async findByPrincipalId(principalId: string): Promise<IdentityRecord | null> {
    const result = await this.pool.query<IdentityRow>(
      `${identitySelect} where p.principal_id = $1`,
      [principalId],
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }

  async changeHandle(cardId: string, nextHandle: string): Promise<IdentityRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cardResult = await client.query<{ status: CardStatus }>(
        'select status from ai_cards where card_id = $1 for update',
        [cardId],
      );
      const card = cardResult.rows[0];
      if (!card) throw new IdentityNotFoundError();
      if (card.status === 'retired') throw new IdentityStateError('A retired Card cannot change handle');

      await client.query(
        `update card_handles
         set is_current = false, retired_at = now()
         where card_id = $1 and is_current`,
        [cardId],
      );
      await client.query(
        'insert into card_handles (handle, card_id) values ($1, $2)',
        [nextHandle, cardId],
      );
      await client.query('update ai_cards set updated_at = now() where card_id = $1', [cardId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) {
        throw new IdentityConflictError('Handle is already reserved');
      }
      throw error;
    } finally {
      client.release();
    }

    const identity = await this.findByCardId(cardId);
    if (!identity) throw new IdentityNotFoundError();
    return identity;
  }

  async transitionStatus(
    cardId: string,
    currentStatus: CardStatus,
    nextStatus: CardStatus,
  ): Promise<IdentityRecord> {
    const result = await this.pool.query(
      `update ai_cards
       set status = $1,
           retired_at = case when $1 = 'retired' then now() else null end,
           updated_at = now()
       where card_id = $2 and status = $3`,
      [nextStatus, cardId, currentStatus],
    );
    if (result.rowCount !== 1) {
      throw new IdentityStateError('Card state changed before this transition completed');
    }

    const identity = await this.findByCardId(cardId);
    if (!identity) throw new IdentityNotFoundError();
    return identity;
  }

  async listControllers(principalId: string): Promise<ControllerSummary[]> {
    const result = await this.pool.query<{
      card_id: string;
      display_name: string;
      handle: string;
      verified_at: Date;
    }>(
      `select c.card_id, c.display_name, h.handle, pc.verified_at
       from principal_controllers pc
       join ai_cards c on c.principal_id = pc.controller_principal_id
       join card_handles h on h.card_id = c.card_id and h.is_current
       where pc.controlled_principal_id = $1 and pc.revoked_at is null
       order by pc.verified_at, c.card_id`,
      [principalId],
    );

    return result.rows.map((row) => ({
      cardId: row.card_id,
      displayName: row.display_name,
      handle: row.handle,
      verifiedAt: row.verified_at,
    }));
  }

  async listHandleHistory(cardId: string): Promise<HandleHistoryEntry[]> {
    const result = await this.pool.query<{ handle: string; retired_at: Date }>(
      `select handle, retired_at
       from card_handles
       where card_id = $1 and not is_current
       order by retired_at desc`,
      [cardId],
    );
    return result.rows.map((row) => ({ handle: row.handle, retiredAt: row.retired_at }));
  }

  async getOrCreatePlatformSubject(principalId: string, clientId: string): Promise<string> {
    const subject = createPairwiseSubject();
    const insertResult = await this.pool.query<{ subject: string }>(
      `insert into platform_subjects (client_id, principal_id, subject)
       values ($1, $2, $3)
       on conflict (client_id, principal_id) do nothing
       returning subject`,
      [clientId, principalId, subject],
    );
    if (insertResult.rows[0]) return insertResult.rows[0].subject;

    const existing = await this.pool.query<{ subject: string }>(
      'select subject from platform_subjects where client_id = $1 and principal_id = $2',
      [clientId, principalId],
    );
    if (!existing.rows[0]) throw new IdentityNotFoundError();
    return existing.rows[0].subject;
  }
}
