import type { Pool } from 'pg';

import type { SealedTokenResponse } from '@/server/authorization/token-response-seal';
import { openTokenResponse, sealTokenResponse } from '@/server/authorization/token-response-seal';

export type ProductLoginFlowRecord = {
  clientId: string;
  redirectUri: string;
  stateHash: Buffer;
  sealedVerifier: SealedTokenResponse;
  expiresAt: Date;
};

export type ProductMemberView = {
  memberId: string;
  clientId: string;
  subject: string;
  cardId: string;
  principalType: 'human' | 'ai';
  displayName: string;
  handle: string;
};

export type ProductLoginResult = {
  member: ProductMemberView;
  sessionToken: string;
  expiresAt: string;
};

type FlowRow = {
  client_id: string;
  redirect_uri: string;
  state_hash: Buffer;
  verifier_ciphertext: Buffer;
  verifier_iv: Buffer;
  verifier_tag: Buffer;
  expires_at: Date;
};

type CompletedFlowRow = FlowRow & {
  consumed_at: Date | null;
  response_ciphertext: Buffer | null;
  response_iv: Buffer | null;
  response_tag: Buffer | null;
};

export class PostgresProductFederationRepository {
  constructor(private readonly pool: Pool) {}

  async createFlow(input: ProductLoginFlowRecord & { flowHash: Buffer }): Promise<void> {
    await this.pool.query(
      `insert into reference_product.login_flows
        (flow_hash, client_id, redirect_uri, state_hash,
         verifier_ciphertext, verifier_iv, verifier_tag, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.flowHash,
        input.clientId,
        input.redirectUri,
        input.stateHash,
        input.sealedVerifier.ciphertext,
        input.sealedVerifier.iv,
        input.sealedVerifier.tag,
        input.expiresAt,
      ],
    );
  }

  async findFlow(flowHash: Buffer): Promise<ProductLoginFlowRecord | null> {
    const result = await this.pool.query<FlowRow>(
      `select client_id, redirect_uri, state_hash,
              verifier_ciphertext, verifier_iv, verifier_tag, expires_at
       from reference_product.login_flows
       where flow_hash = $1`,
      [flowHash],
    );
    const row = result.rows[0];
    return row ? {
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      stateHash: row.state_hash,
      sealedVerifier: {
        ciphertext: row.verifier_ciphertext,
        iv: row.verifier_iv,
        tag: row.verifier_tag,
      },
      expiresAt: row.expires_at,
    } : null;
  }

  async completeFlow(input: {
    flowHash: Buffer;
    memberId: string;
    sessionHash: Buffer;
    sessionExpiresAt: Date;
    identity: Omit<ProductMemberView, 'memberId'>;
    result: ProductLoginResult;
    recoverySecret: string;
    idempotencyKey: string;
  }): Promise<ProductLoginResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const flowResult = await client.query<CompletedFlowRow>(
        `select client_id, redirect_uri, state_hash,
                verifier_ciphertext, verifier_iv, verifier_tag, expires_at,
                consumed_at, response_ciphertext, response_iv, response_tag
         from reference_product.login_flows
         where flow_hash = $1
         for update`,
        [input.flowHash],
      );
      const flow = flowResult.rows[0];
      if (!flow || flow.expires_at.getTime() <= Date.now()) {
        throw new Error('Product login flow is invalid or expired');
      }
      if (flow.consumed_at) {
        if (!flow.response_ciphertext || !flow.response_iv || !flow.response_tag) {
          throw new Error('Product login flow is invalid or expired');
        }
        const recovered = openTokenResponse<ProductLoginResult>({
          ciphertext: flow.response_ciphertext,
          iv: flow.response_iv,
          tag: flow.response_tag,
        }, input.recoverySecret, input.idempotencyKey);
        await client.query('commit');
        return recovered;
      }
      if (flow.client_id !== input.identity.clientId) {
        throw new Error('Product login flow does not match the authorization result');
      }

      const member = await client.query<ProductMemberView & {
        member_id: string;
        client_id: string;
        card_id: string;
        principal_type: 'human' | 'ai';
        display_name: string;
      }>(
        `insert into reference_product.members
          (member_id, client_id, subject, card_id, principal_type, display_name, handle)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (client_id, subject) do update
           set card_id = excluded.card_id,
               principal_type = excluded.principal_type,
               display_name = excluded.display_name,
               handle = excluded.handle,
               updated_at = now()
         returning member_id, client_id, subject, card_id, principal_type, display_name, handle`,
        [
          input.memberId,
          input.identity.clientId,
          input.identity.subject,
          input.identity.cardId,
          input.identity.principalType,
          input.identity.displayName,
          input.identity.handle,
        ],
      );
      const row = member.rows[0];
      if (!row) throw new Error('Product member could not be established');
      await client.query(
        `insert into reference_product.sessions (session_hash, member_id, expires_at)
         values ($1, $2, $3)`,
        [input.sessionHash, row.member_id, input.sessionExpiresAt],
      );
      const response: ProductLoginResult = {
        ...input.result,
        member: {
          memberId: row.member_id,
          clientId: row.client_id,
          subject: row.subject,
          cardId: row.card_id,
          principalType: row.principal_type,
          displayName: row.display_name,
          handle: row.handle,
        },
      };
      const sealed = sealTokenResponse(response, input.recoverySecret, input.idempotencyKey);
      await client.query(
        `update reference_product.login_flows
         set consumed_at = now(), response_ciphertext = $2, response_iv = $3, response_tag = $4
         where flow_hash = $1`,
        [input.flowHash, sealed.ciphertext, sealed.iv, sealed.tag],
      );
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveSession(sessionHash: Buffer): Promise<ProductMemberView | null> {
    const result = await this.pool.query<{
      member_id: string;
      client_id: string;
      subject: string;
      card_id: string;
      principal_type: 'human' | 'ai';
      display_name: string;
      handle: string;
    }>(
      `select m.member_id, m.client_id, m.subject, m.card_id, m.principal_type,
              m.display_name, m.handle
       from reference_product.sessions s
       join reference_product.members m on m.member_id = s.member_id
       where s.session_hash = $1 and s.revoked_at is null and s.expires_at > now()`,
      [sessionHash],
    );
    const row = result.rows[0];
    return row ? {
      memberId: row.member_id,
      clientId: row.client_id,
      subject: row.subject,
      cardId: row.card_id,
      principalType: row.principal_type,
      displayName: row.display_name,
      handle: row.handle,
    } : null;
  }
}
