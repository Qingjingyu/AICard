import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  agentClaimPayload,
  buildAgentEnrollmentInstructions,
  nodeRuntimeAuthenticationPayload,
  normalizeMachineName,
  verifyAgentSignature,
} from '@/domain/identity/agent-enrollment';

describe('Agent enrollment protocol', () => {
  it('keeps Chinese display names while deriving a safe stable machine name', () => {
    expect(normalizeMachineName('悠悠 助理', 'yoyoo_assistant')).toBe('yoyoo_assistant');
    expect(normalizeMachineName('Research Agent 01', 'fallback')).toBe('research-agent-01');
  });

  it('verifies the canonical claim payload with Ed25519', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    const payload = agentClaimPayload({
      invitationId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      claimId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a2',
      machineName: 'yoyoo_assistant',
      publicKey: publicKeySpki,
    });
    const signature = sign(null, Buffer.from(payload), privateKey).toString('base64url');

    expect(verifyAgentSignature(publicKeySpki, payload, signature)).toBe(true);
    expect(verifyAgentSignature(publicKeySpki, `${payload}\ntampered`, signature)).toBe(false);
  });

  it('binds a runtime signature to the node, platform client, and challenge', () => {
    expect(nodeRuntimeAuthenticationPayload(
      '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      'yoyoo_dev',
      'A'.repeat(43),
    )).toBe([
      'aicard-agent-runtime-v1',
      '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      'yoyoo_dev',
      'A'.repeat(43),
    ].join('\n'));
  });

  it('builds a complete instruction instead of exposing a context-free ticket', () => {
    const instruction = buildAgentEnrollmentInstructions({
      displayName: '悠悠',
      cardId: 'AI_100001',
      invitationId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      serviceUrl: 'https://id.example.com',
      ticket: 'A'.repeat(43),
      expiresAt: new Date('2026-08-08T12:30:00.000Z'),
      recommendedMachineName: 'yoyoo_assistant',
    });

    expect(instruction).toContain('请将当前 Agent 接入 AI Card');
    expect(instruction).toContain('昵称：悠悠');
    expect(instruction).toContain('服务地址：https://id.example.com');
    expect(instruction).toContain(`邀请票据：${'A'.repeat(43)}`);
    expect(instruction).toContain('在本机生成 Ed25519 密钥对');
    expect(instruction).toContain('不要回显邀请票据');
  });
});
