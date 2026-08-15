import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import {
  agentClaimPayload,
  agentClaimSchema,
  agentClaimStatusSchema,
  buildAgentEnrollmentInstructions,
  createAgentInvitationSchema,
  nodeAuthenticationPayload,
  nodeAuthenticationSchema,
  nodeRuntimeAuthenticationPayload,
  nodeChallengeSchema,
  normalizeMachineName,
  verifyAgentSignature,
} from '@/domain/identity/agent-enrollment';
import { createPairwiseSubject, createPrincipalId } from '@/domain/identity/ids';
import { principalIdSchema } from '@/domain/identity/schemas';
import { createOpaqueToken, hashOpaqueToken } from '@/server/authentication/auth-security';
import {
  AgentEnrollmentStateError,
  AgentEnrollmentVerificationError,
} from '@/server/agent-enrollment-errors';
import { PlatformAccessTokenError } from '@/server/authorization/errors';
import type { PostgresAgentEnrollmentRepository } from '@/server/postgres/agent-enrollment-repository';

const INVITATION_TTL_MS = 15 * 60 * 1_000;
const NODE_CHALLENGE_TTL_MS = 2 * 60 * 1_000;
const RUNTIME_TOKEN_TTL_MS = 2 * 60 * 1_000;
const runtimeTokenSchema = z.string().regex(/^at_[A-Za-z0-9_-]{43}$/);
const declineInvitationSchema = z.object({
  invitationId: z.uuid(),
  ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

export class AgentEnrollmentService {
  constructor(
    private readonly repository: PostgresAgentEnrollmentRepository,
    private readonly config: { serviceUrl: string },
  ) {}

  async createInvitation(controllerPrincipalId: string, input: unknown) {
    principalIdSchema.parse(controllerPrincipalId);
    const parsed = createAgentInvitationSchema.parse(input);
    const invitationId = createPrincipalId();
    const ticket = createOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const created = await this.repository.createInvitation({
      controllerPrincipalId,
      ...parsed,
      invitationId,
      ticketHash: hashOpaqueToken(ticket),
      expiresAt,
    });
    const recommendedMachineName = normalizeMachineName(
      created.identity.displayName,
      created.identity.handle ?? 'agent',
    );
    return {
      invitationId,
      ticket,
      expiresAt,
      identity: created.identity,
      claim: {
        serviceUrl: this.config.serviceUrl,
        invitationId,
        ticket,
        machineName: recommendedMachineName,
        clientId: parsed.clientId,
      },
      instructions: buildAgentEnrollmentInstructions({
        displayName: created.identity.displayName,
        cardId: created.identity.cardId,
        invitationId,
        serviceUrl: this.config.serviceUrl,
        ticket,
        expiresAt,
        recommendedMachineName,
      }),
    };
  }

  async claim(input: unknown) {
    const parsed = agentClaimSchema.parse(input);
    const payload = agentClaimPayload({
      invitationId: parsed.invitationId,
      claimId: parsed.claimId,
      machineName: parsed.machineName,
      publicKey: parsed.publicKey,
    });
    if (!verifyAgentSignature(parsed.publicKey, payload, parsed.signature)) {
      throw new AgentEnrollmentVerificationError();
    }
    return this.repository.claim({
      invitationId: parsed.invitationId,
      ticketHash: hashOpaqueToken(parsed.ticket),
      claimId: parsed.claimId,
      claimSecretHash: hashOpaqueToken(parsed.claimSecret),
      nodeId: createPrincipalId(),
      machineName: parsed.machineName,
      publicKeySpki: Buffer.from(parsed.publicKey, 'base64url'),
      grantId: createPrincipalId(),
      subjectCandidate: createPairwiseSubject(),
    });
  }

  async getClaimStatus(input: unknown) {
    const parsed = agentClaimStatusSchema.parse(input);
    const result = await this.repository.getClaimStatus(parsed.claimId, hashOpaqueToken(parsed.claimSecret));
    if (!result) throw new AgentEnrollmentStateError('Claim could not be recovered');
    return result;
  }

  async declineInvitation(input: unknown): Promise<void> {
    const parsed = declineInvitationSchema.parse(input);
    await this.repository.declineInvitation(
      parsed.invitationId,
      hashOpaqueToken(parsed.ticket),
    );
  }

  async createNodeChallenge(nodeId: string) {
    const parsed = nodeChallengeSchema.parse({ nodeId });
    const challengeId = createPrincipalId();
    const challenge = createOpaqueToken();
    const expiresAt = new Date(Date.now() + NODE_CHALLENGE_TTL_MS);
    await this.repository.createNodeChallenge({
      nodeId: parsed.nodeId,
      challengeId,
      challengeHash: hashOpaqueToken(challenge),
      expiresAt,
    });
    return { challengeId, challenge, expiresAt };
  }

  async authenticateNode(input: unknown) {
    const parsed = nodeAuthenticationSchema.parse(input);
    const consumed = await this.repository.consumeNodeChallenge({
      nodeId: parsed.nodeId,
      challengeId: parsed.challengeId,
    });
    const receivedHash = hashOpaqueToken(parsed.challenge);
    if (!timingSafeEqual(consumed.challengeHash, receivedHash)) {
      throw new AgentEnrollmentVerificationError('Node challenge verification failed');
    }
    const publicKey = consumed.publicKeySpki.toString('base64url');
    const payload = parsed.clientId
      ? nodeRuntimeAuthenticationPayload(parsed.nodeId, parsed.clientId, parsed.challenge)
      : nodeAuthenticationPayload(parsed.nodeId, parsed.challenge);
    if (!verifyAgentSignature(publicKey, payload, parsed.signature)) {
      throw new AgentEnrollmentVerificationError('Node signature verification failed');
    }
    await this.repository.markNodeAuthenticated(parsed.nodeId);
    if (!parsed.clientId) {
      return { nodeId: parsed.nodeId, connectionStatus: 'connected' as const };
    }
    const accessToken = `at_${createOpaqueToken()}`;
    const expiresAt = new Date(Date.now() + RUNTIME_TOKEN_TTL_MS);
    const runtime = await this.repository.issueRuntimeToken({
      nodeId: parsed.nodeId,
      clientId: parsed.clientId,
      tokenHash: hashOpaqueToken(accessToken),
      expiresAt,
    });
    return {
      nodeId: parsed.nodeId,
      connectionStatus: 'connected' as const,
      runtime: {
        ...runtime,
        accessToken,
        tokenType: 'Bearer' as const,
        expiresIn: RUNTIME_TOKEN_TTL_MS / 1_000,
        expiresAt,
        scope: 'agent.runtime' as const,
      },
    };
  }

  async introspectRuntimeToken(accessToken: string) {
    const parsed = runtimeTokenSchema.safeParse(accessToken);
    if (!parsed.success) {
      throw new PlatformAccessTokenError('Agent runtime token is invalid or expired');
    }
    return this.repository.introspectRuntimeToken(hashOpaqueToken(parsed.data));
  }

  async revokeNode(controllerPrincipalId: string, nodeId: string): Promise<void> {
    principalIdSchema.parse(controllerPrincipalId);
    principalIdSchema.parse(nodeId);
    await this.repository.revokeNode(controllerPrincipalId, nodeId);
  }

  async revokeInvitation(controllerPrincipalId: string, invitationId: string): Promise<void> {
    principalIdSchema.parse(controllerPrincipalId);
    principalIdSchema.parse(invitationId);
    await this.repository.revokeInvitation(controllerPrincipalId, invitationId);
  }

  async listManagedAgents(controllerPrincipalId: string) {
    principalIdSchema.parse(controllerPrincipalId);
    return this.repository.listManagedAgents(controllerPrincipalId);
  }
}
