import { generateKeyPairSync, sign } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import {
  agentClaimPayload,
  nodeAuthenticationPayload,
  nodeRuntimeAuthenticationPayload,
} from '@/domain/identity/agent-enrollment';
import { createPrincipalId } from '@/domain/identity/ids';
import { createOpaqueToken, hashOpaqueToken } from '@/server/authentication/auth-security';
import { AgentEnrollmentService } from '@/server/agent-enrollment-service';
import { AgentEnrollmentStateError } from '@/server/agent-enrollment-errors';
import { PlatformAuthorizationService } from '@/server/authorization/authorization-service';
import { PlatformAccessTokenError } from '@/server/authorization/errors';
import { IdentityService } from '@/server/identity-service';
import { PostgresAgentEnrollmentRepository } from '@/server/postgres/agent-enrollment-repository';
import { PostgresIdentityRepository } from '@/server/postgres/identity-repository';
import { PostgresPlatformAuthorizationRepository } from '@/server/postgres/platform-authorization-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Agent enrollment tests');

const pool = createPostgresPool(databaseUrl);
const repository = new PostgresAgentEnrollmentRepository(pool);
const service = new AgentEnrollmentService(repository, { serviceUrl: 'http://localhost:3000' });
const identities = new IdentityService(new PostgresIdentityRepository(pool));
const authorizations = new PlatformAuthorizationService(
  new PostgresPlatformAuthorizationRepository(pool),
);

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

beforeEach(async () => {
  await pool.query('delete from principals');
  await pool.query('delete from auth_challenges');
  await pool.query('delete from auth_rate_limits');
  await pool.query('delete from security_audit_events');
});

afterAll(async () => {
  await pool.end();
});

async function createController() {
  return identities.createCard({
    principalType: 'human',
    displayName: '苏白',
    handle: `controller_${Date.now().toString(36)}`,
  });
}

function signedClaim(input: {
  invitationId: string;
  ticket: string;
  machineName?: string;
  claimId?: string;
  claimSecret?: string;
}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const claimId = input.claimId ?? createPrincipalId();
  const claimSecret = input.claimSecret ?? createOpaqueToken();
  const machineName = input.machineName ?? 'yoyoo-agent';
  const payload = agentClaimPayload({
    invitationId: input.invitationId,
    claimId,
    machineName,
    publicKey: publicKeySpki,
  });
  const signature = sign(null, Buffer.from(payload), privateKey).toString('base64url');
  return {
    request: {
      invitationId: input.invitationId,
      ticket: input.ticket,
      claimId,
      claimSecret,
      machineName,
      publicKey: publicKeySpki,
      signature,
    },
    privateKey,
  };
}

describe('Agent enrollment service', () => {
  it('creates a one-time invitation without consuming an AI Card number', async () => {
    const controller = await createController();
    const before = await pool.query<{ cards: string; principals: string }>(
      `select
         (select count(*) from ai_cards)::text as cards,
         (select count(*) from principals)::text as principals`,
    );
    const invitation = await service.createInvitation(controller.principalId, {
      displayName: '悠悠助理',
      clientId: 'yoyoo_dev',
    });

    expect(invitation.identity).toEqual({
      displayName: '悠悠助理',
      cardId: null,
      handle: null,
    });
    expect(invitation.claim).toMatchObject({
      serviceUrl: 'http://localhost:3000',
      invitationId: invitation.invitationId,
      ticket: invitation.ticket,
      clientId: 'yoyoo_dev',
    });
    expect(invitation.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitation.instructions).toContain('请将当前 Agent 接入 AI Card');
    const stored = await pool.query<{
      ticket_hash: Buffer; display_name: string; card_id: string | null; client_id: string;
    }>(
      `select ticket_hash, display_name, card_id, client_id
       from agent_invitations where invitation_id = $1`,
      [invitation.invitationId],
    );
    expect(stored.rows[0]?.ticket_hash.equals(hashOpaqueToken(invitation.ticket))).toBe(true);
    expect(stored.rows[0]).toMatchObject({
      display_name: '悠悠助理',
      card_id: null,
      client_id: 'yoyoo_dev',
    });
    expect(JSON.stringify(stored.rows)).not.toContain(invitation.ticket);
    const after = await pool.query<{ cards: string; principals: string }>(
      `select
         (select count(*) from ai_cards)::text as cards,
         (select count(*) from principals)::text as principals`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('claims once with proof of key possession and safely recovers the same result', async () => {
    const controller = await createController();
    const invitation = await service.createInvitation(controller.principalId, {
      displayName: '研究助理',
      clientId: 'yoyoo_dev',
    });
    const claim = signedClaim(invitation);

    const first = await service.claim(claim.request);
    const retry = await service.claim(claim.request);
    const recovered = await service.getClaimStatus({
      claimId: claim.request.claimId,
      claimSecret: claim.request.claimSecret,
    });

    expect(first).toMatchObject({
      cardId: expect.stringMatching(/^AI_[1-9][0-9]{5,}$/),
      machineName: 'yoyoo-agent',
      claimStatus: 'claimed',
      connectionStatus: 'connected',
    });
    expect(retry.nodeId).toBe(first.nodeId);
    expect(recovered.nodeId).toBe(first.nodeId);
    expect((await pool.query('select node_id from agent_nodes')).rowCount).toBe(1);
    expect((await pool.query('select claim_id from agent_claims')).rowCount).toBe(1);
    expect((await pool.query(
      `select grant_id from platform_grants
       where principal_id = (select principal_id from ai_cards where card_id = $1)
         and client_id = 'yoyoo_dev' and status = 'active'
         and scopes = array['agent.runtime']::text[]`,
      [first.cardId],
    )).rowCount).toBe(1);

    await expect(service.getClaimStatus({
      claimId: claim.request.claimId,
      claimSecret: createOpaqueToken(),
    })).rejects.toBeInstanceOf(AgentEnrollmentStateError);

    const replay = signedClaim({
      invitationId: invitation.invitationId,
      ticket: invitation.ticket,
    });
    await expect(service.claim(replay.request)).rejects.toBeInstanceOf(AgentEnrollmentStateError);
  });

  it('uses one-time challenges for node authentication and rejects revoked nodes', async () => {
    const controller = await createController();
    const invitation = await service.createInvitation(controller.principalId, {
      displayName: '执行助理',
      handle: `executor_${Date.now().toString(36)}`,
    });
    const claim = signedClaim(invitation);
    const enrolled = await service.claim(claim.request);
    const challenge = await service.createNodeChallenge(enrolled.nodeId);
    const signature = sign(
      null,
      Buffer.from(nodeAuthenticationPayload(enrolled.nodeId, challenge.challenge)),
      claim.privateKey,
    ).toString('base64url');

    const authenticated = await service.authenticateNode({
      nodeId: enrolled.nodeId,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      signature,
    });
    expect(authenticated.connectionStatus).toBe('connected');
    await expect(service.authenticateNode({
      nodeId: enrolled.nodeId,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      signature,
    })).rejects.toBeInstanceOf(AgentEnrollmentStateError);

    await service.revokeNode(controller.principalId, enrolled.nodeId);
    await expect(service.createNodeChallenge(enrolled.nodeId))
      .rejects.toBeInstanceOf(AgentEnrollmentStateError);
    const events = await pool.query<{ event_type: string }>(
      `select event_type from security_audit_events
       where target_id = $1 order by created_at`,
      [enrolled.nodeId],
    );
    expect(events.rows.map((event) => event.event_type)).toEqual([
      'agent.node.claimed',
      'agent.node.authenticated',
      'agent.node.revoked',
    ]);
  });

  it('issues a hash-only Yoyoo runtime session and rejects it after node revocation', async () => {
    const controller = await createController();
    const invitation = await service.createInvitation(controller.principalId, {
      displayName: '运行助理',
      handle: `runtime_${Date.now().toString(36)}`,
    });
    const claim = signedClaim(invitation);
    const enrolled = await service.claim(claim.request);
    const challenge = await service.createNodeChallenge(enrolled.nodeId);
    const signature = sign(
      null,
      Buffer.from(nodeRuntimeAuthenticationPayload(
        enrolled.nodeId,
        'yoyoo_dev',
        challenge.challenge,
      )),
      claim.privateKey,
    ).toString('base64url');

    const authenticated = await service.authenticateNode({
      nodeId: enrolled.nodeId,
      clientId: 'yoyoo_dev',
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      signature,
    });
    expect(authenticated.runtime).toMatchObject({
      accessToken: expect.stringMatching(/^at_[A-Za-z0-9_-]{43}$/),
      tokenType: 'Bearer',
      expiresIn: 120,
      scope: 'agent.runtime',
      audience: 'yoyoo',
    });
    const session = await service.introspectRuntimeToken(authenticated.runtime!.accessToken);
    expect(session).toMatchObject({
      active: true,
      nodeId: enrolled.nodeId,
      clientId: 'yoyoo_dev',
      audience: 'yoyoo',
      scope: 'agent.runtime',
    });
    const stored = await pool.query<{ token_hash: Buffer }>(
      'select token_hash from agent_runtime_tokens where node_id = $1',
      [enrolled.nodeId],
    );
    expect(stored.rows[0]?.token_hash.equals(
      hashOpaqueToken(authenticated.runtime!.accessToken),
    )).toBe(true);
    expect(JSON.stringify(stored.rows)).not.toContain(authenticated.runtime!.accessToken);

    await service.revokeNode(controller.principalId, enrolled.nodeId);
    await expect(service.introspectRuntimeToken(authenticated.runtime!.accessToken))
      .rejects.toBeInstanceOf(PlatformAccessTokenError);
  });

  it('rejects an issued runtime session immediately after Yoyoo grant revocation', async () => {
    const controller = await createController();
    const invitation = await service.createInvitation(controller.principalId, {
      displayName: '授权撤销助理',
      handle: `grant_revoke_${Date.now().toString(36)}`,
    });
    const claim = signedClaim(invitation);
    const enrolled = await service.claim(claim.request);
    const agentIdentity = await pool.query<{ principal_id: string }>(
      'select principal_id from ai_cards where card_id = $1',
      [enrolled.cardId],
    );
    const agentPrincipalId = agentIdentity.rows[0]!.principal_id;
    const challenge = await service.createNodeChallenge(enrolled.nodeId);
    const signature = sign(
      null,
      Buffer.from(nodeRuntimeAuthenticationPayload(
        enrolled.nodeId,
        'yoyoo_dev',
        challenge.challenge,
      )),
      claim.privateKey,
    ).toString('base64url');
    const authenticated = await service.authenticateNode({
      nodeId: enrolled.nodeId,
      clientId: 'yoyoo_dev',
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      signature,
    });
    const grants = await authorizations.listGrants(agentPrincipalId);

    expect(grants).toHaveLength(1);
    await authorizations.revokeGrant({
      principalId: agentPrincipalId,
      grantId: grants[0]!.grantId,
    });

    await expect(service.introspectRuntimeToken(authenticated.runtime!.accessToken))
      .rejects.toBeInstanceOf(PlatformAccessTokenError);
  });

  it('adds independent nodes to one Card and invalidates a revoked pending invitation', async () => {
    const controller = await createController();
    const firstInvitation = await service.createInvitation(controller.principalId, {
      displayName: '多节点助理',
      handle: `multi_${Date.now().toString(36)}`,
    });
    const firstClaim = signedClaim(firstInvitation);
    const firstNode = await service.claim(firstClaim.request);

    const secondInvitation = await service.createInvitation(controller.principalId, {
      cardId: firstNode.cardId,
    });
    const secondClaim = signedClaim({
      invitationId: secondInvitation.invitationId,
      ticket: secondInvitation.ticket,
      machineName: 'yoyoo-agent-02',
    });
    const secondNode = await service.claim(secondClaim.request);

    expect(secondInvitation.identity.cardId).toBe(firstNode.cardId);
    expect(secondNode.cardId).toBe(firstNode.cardId);
    expect(secondNode.nodeId).not.toBe(firstNode.nodeId);
    expect((await pool.query(
      'select node_id from agent_nodes where principal_id = $1',
      [(await pool.query<{ principal_id: string }>(
        'select principal_id from ai_cards where card_id = $1',
        [firstNode.cardId],
      )).rows[0]!.principal_id],
    )).rowCount).toBe(2);

    const revoked = await service.createInvitation(controller.principalId, {
      cardId: firstNode.cardId,
    });
    await service.revokeInvitation(controller.principalId, revoked.invitationId);
    await expect(service.claim(signedClaim(revoked).request))
      .rejects.toBeInstanceOf(AgentEnrollmentStateError);
    expect((await pool.query(
      `select event_id from security_audit_events
       where event_type = 'agent.invitation.revoked' and target_id = $1`,
      [revoked.invitationId],
    )).rowCount).toBe(1);
  });

  it('lets an existing Agent decline the unused fresh identity invitation by ticket', async () => {
    const controller = await createController();
    const before = await pool.query<{ count: string }>(
      `select count(*)::text as count from ai_cards cards
       join principals on principals.principal_id = cards.principal_id
       where principals.principal_type = 'ai'`,
    );
    const invitation = await service.createInvitation(controller.principalId, {
      displayName: '已有身份 Agent',
      clientId: 'yoyoo_dev',
    });

    await service.declineInvitation({
      invitationId: invitation.invitationId,
      ticket: invitation.ticket,
    });

    await expect(service.claim(signedClaim(invitation).request))
      .rejects.toBeInstanceOf(AgentEnrollmentStateError);
    const after = await pool.query<{ count: string }>(
      `select count(*)::text as count from ai_cards cards
       join principals on principals.principal_id = cards.principal_id
       where principals.principal_type = 'ai'`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
