import { createPublicKey, verify } from 'node:crypto';

import { z } from 'zod';

import { cardIdSchema, displayNameSchema, principalIdSchema } from './schemas';

const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const signatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const publicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{40,342}$/);
const platformClientIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/);

export const machineNameSchema = z.string()
  .transform((value) => value.normalize('NFKC').trim().toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, 'machine_name has an invalid format'));

export const createAgentInvitationSchema = z.union([
  z.object({ displayName: displayNameSchema, clientId: platformClientIdSchema.default('yoyoo_dev') }),
  z.object({ cardId: cardIdSchema, clientId: platformClientIdSchema.default('yoyoo_dev') }),
]);

export const agentClaimSchema = z.object({
  invitationId: principalIdSchema,
  ticket: opaqueTokenSchema,
  claimId: principalIdSchema,
  claimSecret: opaqueTokenSchema,
  machineName: machineNameSchema,
  publicKey: publicKeySchema,
  signature: signatureSchema,
});

export const agentClaimStatusSchema = z.object({
  claimId: principalIdSchema,
  claimSecret: opaqueTokenSchema,
});

export const nodeChallengeSchema = z.object({ nodeId: principalIdSchema });

export const nodeAuthenticationSchema = z.object({
  nodeId: principalIdSchema,
  clientId: platformClientIdSchema.optional(),
  challengeId: principalIdSchema,
  challenge: opaqueTokenSchema,
  signature: signatureSchema,
});

export function normalizeMachineName(displayName: string, fallback: string): string {
  const normalized = displayName.normalize('NFKC').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return machineNameSchema.parse(normalized || fallback);
}

export function agentClaimPayload(input: {
  invitationId: string;
  claimId: string;
  machineName: string;
  publicKey: string;
}): string {
  return [
    'aicard-agent-claim-v1',
    input.invitationId,
    input.claimId,
    input.machineName,
    input.publicKey,
  ].join('\n');
}

export function nodeAuthenticationPayload(nodeId: string, challenge: string): string {
  return ['aicard-node-auth-v1', nodeId, challenge].join('\n');
}

export function nodeRuntimeAuthenticationPayload(
  nodeId: string,
  clientId: string,
  challenge: string,
): string {
  return ['aicard-agent-runtime-v1', nodeId, clientId, challenge].join('\n');
}

export function verifyAgentSignature(publicKey: string, payload: string, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

export function buildAgentEnrollmentInstructions(input: {
  displayName: string;
  cardId?: string | null;
  invitationId: string;
  serviceUrl: string;
  ticket: string;
  expiresAt: Date;
  recommendedMachineName: string;
}): string {
  displayNameSchema.parse(input.displayName);
  if (input.cardId) cardIdSchema.parse(input.cardId);
  principalIdSchema.parse(input.invitationId);
  return `请将当前 Agent 接入 AI Card：

昵称：${input.displayName}
${input.cardId ? `AI Card ID：${input.cardId}` : 'AI Card ID：成功认领后自动颁发，不会因未使用邀请占用编号'}
服务地址：${input.serviceUrl}
邀请 ID：${input.invitationId}
邀请票据：${input.ticket}
有效期至：${input.expiresAt.toISOString()}
建议机器名：${input.recommendedMachineName}

请在本机生成 Ed25519 密钥对、UUIDv7 认领 ID 和 32 字节随机查询秘密。私钥不得上传。
使用私钥签署以下以换行连接的 UTF-8 载荷：
aicard-agent-claim-v1
<邀请 ID>
<认领 ID>
<机器名>
<SPKI DER 公钥的 base64url>

向 POST ${input.serviceUrl}/api/v1/agent-enrollment/claim 提交 invitationId、ticket、claimId、claimSecret、machineName、publicKey 和 signature。
网络结果未知时，不要新建身份；使用 claimId 和 claimSecret 请求 POST ${input.serviceUrl}/api/v1/agent-enrollment/status 恢复结果。

完成后仅回复昵称、AI Card ID、机器名、认领状态和连接状态。不要回显邀请票据、查询秘密、私钥或其他凭据。`;
}
