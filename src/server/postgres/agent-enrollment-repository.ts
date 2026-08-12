import type { Pool, PoolClient } from 'pg';

import { createCardId, createPrincipalId } from '@/domain/identity/ids';
import type { IdentityRecord } from '@/domain/identity/types';
import { AgentEnrollmentStateError } from '@/server/agent-enrollment-errors';
import {
  PlatformAccessTokenError,
  PlatformAuthorizationError,
} from '@/server/authorization/errors';
import { IdentityConflictError } from '@/server/identity-errors';

export type AgentConnectionStatus = 'connected' | 'offline' | 'revoked';

export type AgentNodeResult = {
  nodeId: string;
  cardId: string;
  displayName: string;
  machineName: string;
  claimStatus: 'claimed';
  connectionStatus: AgentConnectionStatus;
};

export type ManagedAgent = {
  invitationId: string;
  cardId: string;
  displayName: string;
  handle: string;
  invitationStatus: 'pending' | 'claimed' | 'expired' | 'revoked';
  expiresAt: Date;
  nodeId: string | null;
  machineName: string | null;
  connectionStatus: AgentConnectionStatus | null;
  lastAuthenticatedAt: Date | null;
};

export type AgentRuntimeSession = {
  active: true;
  subject: string;
  nodeId: string;
  clientId: string;
  audience: string;
  scope: 'agent.runtime';
  expiresAt: Date;
};

function connectionStatus(row: { node_status: 'active' | 'revoked'; online_until: Date | null }): AgentConnectionStatus {
  if (row.node_status === 'revoked') return 'revoked';
  return row.online_until && row.online_until.getTime() > Date.now() ? 'connected' : 'offline';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function requireActiveHuman(client: PoolClient, principalId: string): Promise<void> {
  const result = await client.query<{ principal_type: string; status: string }>(
    `select p.principal_type, c.status
     from principals p join ai_cards c on c.principal_id = p.principal_id
     where p.principal_id = $1 for share`,
    [principalId],
  );
  const row = result.rows[0];
  if (!row || row.principal_type !== 'human' || row.status !== 'active') {
    throw new AgentEnrollmentStateError('An active human controller is required');
  }
}

export class PostgresAgentEnrollmentRepository {
  constructor(private readonly pool: Pool) {}

  async createInvitation(input: {
    controllerPrincipalId: string;
    displayName?: string;
    handle?: string;
    cardId?: string;
    invitationId: string;
    ticketHash: Buffer;
    expiresAt: Date;
  }): Promise<{ card: IdentityRecord; createdAt: Date }> {
    const client = await this.pool.connect();
    let principalId = createPrincipalId();
    let cardId = createCardId();
    let displayName = input.displayName;
    let handle = input.handle;
    let createdAt: Date;
    let updatedAt: Date;
    try {
      await client.query('begin');
      await requireActiveHuman(client, input.controllerPrincipalId);
      if (input.cardId) {
        const existing = await client.query<{
          principal_id: string; card_id: string; display_name: string; handle: string;
          created_at: Date; updated_at: Date;
        }>(
          `select c.principal_id, c.card_id, c.display_name, h.handle, c.created_at, c.updated_at
           from ai_cards c
           join principals p on p.principal_id = c.principal_id and p.principal_type = 'ai'
           join card_handles h on h.card_id = c.card_id and h.is_current
           join principal_controllers pc on pc.controlled_principal_id = c.principal_id
           where c.card_id = $1 and c.status = 'active'
             and pc.controller_principal_id = $2 and pc.revoked_at is null
           for share of c`,
          [input.cardId, input.controllerPrincipalId],
        );
        const row = existing.rows[0];
        if (!row) throw new AgentEnrollmentStateError('AI Card is not managed by this controller');
        principalId = row.principal_id;
        cardId = row.card_id;
        displayName = row.display_name;
        handle = row.handle;
        createdAt = row.created_at;
        updatedAt = row.updated_at;
      } else {
        if (!displayName || !handle) throw new AgentEnrollmentStateError('AI Card identity is required');
        await client.query('insert into principals (principal_id, principal_type) values ($1, $2)', [principalId, 'ai']);
        const cardResult = await client.query<{ created_at: Date; updated_at: Date }>(
          `insert into ai_cards (card_id, principal_id, display_name)
           values ($1, $2, $3) returning created_at, updated_at`,
          [cardId, principalId, displayName],
        );
        const row = cardResult.rows[0];
        if (!row) throw new Error('AI Card insert did not return timestamps');
        createdAt = row.created_at;
        updatedAt = row.updated_at;
        await client.query('insert into card_handles (handle, card_id) values ($1, $2)', [handle, cardId]);
        await client.query(
          `insert into principal_controllers (controlled_principal_id, controller_principal_id)
           values ($1, $2)`,
          [principalId, input.controllerPrincipalId],
        );
      }
      const invitationResult = await client.query<{ created_at: Date }>(
        `insert into agent_invitations
           (invitation_id, card_id, controller_principal_id, ticket_hash, expires_at)
         values ($1, $2, $3, $4, $5) returning created_at`,
        [input.invitationId, cardId, input.controllerPrincipalId, input.ticketHash, input.expiresAt],
      );
      await client.query(
        `insert into security_audit_events
           (event_id, event_type, actor_principal_id, target_type, target_id, result, metadata)
         values ($1, 'agent.invitation.created', $2, 'agent_invitation', $3, 'succeeded', $4)`,
        [createPrincipalId(), input.controllerPrincipalId, input.invitationId, JSON.stringify({ card_id: cardId })],
      );
      await client.query('commit');
      const invitation = invitationResult.rows[0];
      if (!invitation || !displayName || !handle) throw new Error('Invitation insert did not return identity data');
      return {
        card: {
          principalId,
          principalType: 'ai',
          cardId,
          handle,
          displayName,
          avatarUrl: null,
          bio: null,
          status: 'active',
          createdAt,
          updatedAt,
        },
        createdAt: invitation.created_at,
      };
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new IdentityConflictError('Handle is already reserved');
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(input: {
    invitationId: string;
    ticketHash: Buffer;
    claimId: string;
    claimSecretHash: Buffer;
    nodeId: string;
    machineName: string;
    publicKeySpki: Buffer;
  }): Promise<AgentNodeResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const existing = await client.query<{
        node_id: string; card_id: string; display_name: string; machine_name: string;
        node_status: 'active' | 'revoked'; online_until: Date | null;
      }>(
        `select n.node_id, c.card_id, c.display_name, n.machine_name,
                n.status as node_status, n.online_until
         from agent_claims ac
         join agent_nodes n on n.node_id = ac.node_id
         join ai_cards c on c.principal_id = n.principal_id
         where ac.claim_id = $1 and ac.claim_secret_hash = $2`,
        [input.claimId, input.claimSecretHash],
      );
      if (existing.rows[0]) {
        await client.query('commit');
        const row = existing.rows[0];
        return {
          nodeId: row.node_id,
          cardId: row.card_id,
          displayName: row.display_name,
          machineName: row.machine_name,
          claimStatus: 'claimed',
          connectionStatus: connectionStatus(row),
        };
      }
      const sameClaim = await client.query('select 1 from agent_claims where claim_id = $1', [input.claimId]);
      if (sameClaim.rowCount) throw new AgentEnrollmentStateError('Claim could not be recovered');

      const invitationResult = await client.query<{
        card_id: string; principal_id: string; display_name: string; status: string;
        expires_at: Date; card_status: string; controller_active: boolean;
      }>(
        `select i.card_id, c.principal_id, c.display_name, i.status, i.expires_at,
                c.status as card_status,
                exists (
                  select 1 from principal_controllers pc
                  join principals hp on hp.principal_id = pc.controller_principal_id
                  join ai_cards hc on hc.principal_id = hp.principal_id
                  where pc.controlled_principal_id = c.principal_id
                    and pc.controller_principal_id = i.controller_principal_id
                    and pc.revoked_at is null and hp.principal_type = 'human' and hc.status = 'active'
                ) as controller_active
         from agent_invitations i
         join ai_cards c on c.card_id = i.card_id
         where i.invitation_id = $1 and i.ticket_hash = $2
         for update of i`,
        [input.invitationId, input.ticketHash],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) throw new AgentEnrollmentStateError('Invitation is invalid');
      if (invitation.status !== 'pending') throw new AgentEnrollmentStateError('Invitation is no longer available');
      if (invitation.expires_at.getTime() <= Date.now()) throw new AgentEnrollmentStateError('Invitation has expired');
      if (invitation.card_status !== 'active' || !invitation.controller_active) {
        throw new AgentEnrollmentStateError('AI Card or its controller is not active');
      }

      await client.query(
        `insert into agent_nodes
           (node_id, principal_id, machine_name, public_key_spki, last_authenticated_at, online_until)
         values ($1, $2, $3, $4, now(), now() + interval '2 minutes')`,
        [input.nodeId, invitation.principal_id, input.machineName, input.publicKeySpki],
      );
      await client.query(
        `insert into agent_claims (claim_id, invitation_id, node_id, claim_secret_hash)
         values ($1, $2, $3, $4)`,
        [input.claimId, input.invitationId, input.nodeId, input.claimSecretHash],
      );
      await client.query(
        `update agent_invitations set status = 'claimed', claimed_at = now()
         where invitation_id = $1`,
        [input.invitationId],
      );
      await client.query(
        `insert into security_audit_events
           (event_id, event_type, target_type, target_id, result, metadata)
         values ($1, 'agent.node.claimed', 'agent_node', $2, 'succeeded', $3)`,
        [createPrincipalId(), input.nodeId, JSON.stringify({ card_id: invitation.card_id, claim_id: input.claimId })],
      );
      await client.query('commit');
      return {
        nodeId: input.nodeId,
        cardId: invitation.card_id,
        displayName: invitation.display_name,
        machineName: input.machineName,
        claimStatus: 'claimed',
        connectionStatus: 'connected',
      };
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new AgentEnrollmentStateError('Invitation or machine name is already claimed');
      throw error;
    } finally {
      client.release();
    }
  }

  async getClaimStatus(claimId: string, claimSecretHash: Buffer): Promise<AgentNodeResult | null> {
    const result = await this.pool.query<{
      node_id: string; card_id: string; display_name: string; machine_name: string;
      node_status: 'active' | 'revoked'; online_until: Date | null;
    }>(
      `select n.node_id, c.card_id, c.display_name, n.machine_name,
              n.status as node_status, n.online_until
       from agent_claims ac
       join agent_nodes n on n.node_id = ac.node_id
       join ai_cards c on c.principal_id = n.principal_id
       where ac.claim_id = $1 and ac.claim_secret_hash = $2`,
      [claimId, claimSecretHash],
    );
    const row = result.rows[0];
    return row ? {
      nodeId: row.node_id,
      cardId: row.card_id,
      displayName: row.display_name,
      machineName: row.machine_name,
      claimStatus: 'claimed',
      connectionStatus: connectionStatus(row),
    } : null;
  }

  async createNodeChallenge(input: {
    nodeId: string; challengeId: string; challengeHash: Buffer; expiresAt: Date;
  }): Promise<void> {
    const result = await this.pool.query(
      `insert into agent_node_challenges (challenge_id, node_id, challenge_hash, expires_at)
       select $2, node_id, $3, $4 from agent_nodes
       where node_id = $1 and status = 'active'`,
      [input.nodeId, input.challengeId, input.challengeHash, input.expiresAt],
    );
    if (result.rowCount !== 1) throw new AgentEnrollmentStateError('Agent node is not active');
  }

  async consumeNodeChallenge(input: { nodeId: string; challengeId: string }): Promise<{
    challengeHash: Buffer; publicKeySpki: Buffer;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ challenge_hash: Buffer; public_key_spki: Buffer }>(
        `update agent_node_challenges ch
         set consumed_at = now()
         from agent_nodes n
         where ch.challenge_id = $1 and ch.node_id = $2
           and ch.node_id = n.node_id and n.status = 'active'
           and ch.consumed_at is null and ch.expires_at > now()
         returning ch.challenge_hash, n.public_key_spki`,
        [input.challengeId, input.nodeId],
      );
      await client.query('commit');
      const row = result.rows[0];
      if (!row) throw new AgentEnrollmentStateError('Node challenge is invalid or expired');
      return { challengeHash: row.challenge_hash, publicKeySpki: row.public_key_spki };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markNodeAuthenticated(nodeId: string): Promise<void> {
    const result = await this.pool.query(
      `with changed as (
         update agent_nodes
         set last_authenticated_at = now(), online_until = now() + interval '2 minutes'
         where node_id = $1 and status = 'active'
         returning node_id
       )
       insert into security_audit_events
         (event_id, event_type, target_type, target_id, result)
       select $2, 'agent.node.authenticated', 'agent_node', node_id::text, 'succeeded'
       from changed`,
      [nodeId, createPrincipalId()],
    );
    if (result.rowCount !== 1) throw new AgentEnrollmentStateError('Agent node is not active');
  }

  async issueRuntimeToken(input: {
    nodeId: string;
    clientId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  }): Promise<Omit<AgentRuntimeSession, 'active' | 'scope' | 'expiresAt'>> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{
        subject: string;
        node_id: string;
        client_id: string;
        audience: string;
      }>(
        `insert into agent_runtime_tokens
           (token_hash, grant_id, node_id, client_id, subject, audience, expires_at)
         select $3, grants.grant_id, nodes.node_id, clients.client_id,
                subjects.subject, clients.audience, $4
         from agent_nodes nodes
         join principals on principals.principal_id = nodes.principal_id
           and principals.principal_type = 'ai'
         join ai_cards cards on cards.principal_id = nodes.principal_id
           and cards.status = 'active'
         join platform_grants grants on grants.principal_id = nodes.principal_id
           and grants.client_id = $2 and grants.status = 'active'
           and 'agent.runtime' = any(grants.scopes)
         join platform_clients clients on clients.client_id = grants.client_id
           and clients.status = 'active'
         join platform_subjects subjects on subjects.client_id = clients.client_id
           and subjects.principal_id = nodes.principal_id
         where nodes.node_id = $1 and nodes.status = 'active'
           and exists (
             select 1
             from principal_controllers controls
             join principals controller
               on controller.principal_id = controls.controller_principal_id
               and controller.principal_type = 'human'
             join ai_cards controller_card
               on controller_card.principal_id = controller.principal_id
               and controller_card.status = 'active'
             where controls.controlled_principal_id = nodes.principal_id
               and controls.revoked_at is null
           )
         returning subject, node_id, client_id, audience`,
        [input.nodeId, input.clientId, input.tokenHash, input.expiresAt],
      );
      const row = result.rows[0];
      if (!row) throw new PlatformAuthorizationError('Agent runtime access is not authorized');
      await client.query(
        `insert into security_audit_events
           (event_id, event_type, target_type, target_id, result, metadata)
         values ($1, 'agent.runtime.issued', 'agent_node', $2, 'succeeded', $3)`,
        [
          createPrincipalId(),
          input.nodeId,
          JSON.stringify({ client_id: row.client_id, audience: row.audience }),
        ],
      );
      await client.query('commit');
      return {
        subject: row.subject,
        nodeId: row.node_id,
        clientId: row.client_id,
        audience: row.audience,
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async introspectRuntimeToken(tokenHash: Buffer): Promise<AgentRuntimeSession> {
    const result = await this.pool.query<{
      subject: string;
      node_id: string;
      client_id: string;
      audience: string;
      expires_at: Date;
    }>(
      `select tokens.subject, tokens.node_id, tokens.client_id,
              tokens.audience, tokens.expires_at
       from agent_runtime_tokens tokens
       join agent_nodes nodes on nodes.node_id = tokens.node_id
         and nodes.status = 'active'
       join principals on principals.principal_id = nodes.principal_id
         and principals.principal_type = 'ai'
       join ai_cards cards on cards.principal_id = nodes.principal_id
         and cards.status = 'active'
       join platform_grants grants on grants.grant_id = tokens.grant_id
         and grants.client_id = tokens.client_id
         and grants.principal_id = nodes.principal_id
         and grants.status = 'active'
         and 'agent.runtime' = any(grants.scopes)
       join platform_clients clients on clients.client_id = tokens.client_id
         and clients.status = 'active'
         and clients.audience = tokens.audience
       join platform_subjects subjects on subjects.client_id = tokens.client_id
         and subjects.principal_id = nodes.principal_id
         and subjects.subject = tokens.subject
       where tokens.token_hash = $1 and tokens.expires_at > now()
         and exists (
           select 1
           from principal_controllers controls
           join principals controller
             on controller.principal_id = controls.controller_principal_id
             and controller.principal_type = 'human'
           join ai_cards controller_card
             on controller_card.principal_id = controller.principal_id
             and controller_card.status = 'active'
           where controls.controlled_principal_id = nodes.principal_id
             and controls.revoked_at is null
         )`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) throw new PlatformAccessTokenError('Agent runtime token is invalid or expired');
    return {
      active: true,
      subject: row.subject,
      nodeId: row.node_id,
      clientId: row.client_id,
      audience: row.audience,
      scope: 'agent.runtime',
      expiresAt: row.expires_at,
    };
  }

  async revokeNode(controllerPrincipalId: string, nodeId: string): Promise<void> {
    const result = await this.pool.query(
      `with changed as (
         update agent_nodes n
         set status = 'revoked', revoked_at = now(), online_until = null
         from principal_controllers pc
         where n.node_id = $1 and n.status = 'active'
           and pc.controlled_principal_id = n.principal_id
           and pc.controller_principal_id = $2 and pc.revoked_at is null
         returning n.node_id
       )
       insert into security_audit_events
         (event_id, event_type, actor_principal_id, target_type, target_id, result)
       select $3, 'agent.node.revoked', $2, 'agent_node', node_id::text, 'succeeded'
       from changed`,
      [nodeId, controllerPrincipalId, createPrincipalId()],
    );
    if (result.rowCount !== 1) throw new AgentEnrollmentStateError('Agent node cannot be revoked');
  }

  async revokeInvitation(controllerPrincipalId: string, invitationId: string): Promise<void> {
    const result = await this.pool.query(
      `with changed as (
         update agent_invitations
         set status = 'revoked', revoked_at = now()
         where invitation_id = $1 and controller_principal_id = $2 and status = 'pending'
         returning invitation_id
       )
       insert into security_audit_events
         (event_id, event_type, actor_principal_id, target_type, target_id, result)
       select $3, 'agent.invitation.revoked', $2, 'agent_invitation', invitation_id::text, 'succeeded'
       from changed`,
      [invitationId, controllerPrincipalId, createPrincipalId()],
    );
    if (result.rowCount !== 1) throw new AgentEnrollmentStateError('Invitation cannot be revoked');
  }

  async listManagedAgents(controllerPrincipalId: string): Promise<ManagedAgent[]> {
    const result = await this.pool.query<{
      invitation_id: string; card_id: string; display_name: string; handle: string;
      invitation_status: 'pending' | 'claimed' | 'revoked'; expires_at: Date;
      node_id: string | null; machine_name: string | null;
      node_status: 'active' | 'revoked' | null; online_until: Date | null;
      last_authenticated_at: Date | null;
    }>(
      `select i.invitation_id, i.card_id, c.display_name, h.handle,
              i.status as invitation_status, i.expires_at,
              n.node_id, n.machine_name, n.status as node_status,
              n.online_until, n.last_authenticated_at
       from agent_invitations i
       join ai_cards c on c.card_id = i.card_id
       join card_handles h on h.card_id = c.card_id and h.is_current
       left join agent_claims ac on ac.invitation_id = i.invitation_id
       left join agent_nodes n on n.node_id = ac.node_id
       where i.controller_principal_id = $1
       order by i.created_at desc`,
      [controllerPrincipalId],
    );
    return result.rows.map((row) => ({
      invitationId: row.invitation_id,
      cardId: row.card_id,
      displayName: row.display_name,
      handle: row.handle,
      invitationStatus: row.invitation_status === 'pending' && row.expires_at.getTime() <= Date.now()
        ? 'expired' : row.invitation_status,
      expiresAt: row.expires_at,
      nodeId: row.node_id,
      machineName: row.machine_name,
      connectionStatus: row.node_status ? connectionStatus({ node_status: row.node_status, online_until: row.online_until }) : null,
      lastAuthenticatedAt: row.last_authenticated_at,
    }));
  }
}
