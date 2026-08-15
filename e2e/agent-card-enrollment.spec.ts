import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';

import { agentClaimPayload } from '../src/domain/identity/agent-enrollment';
import { createPrincipalId } from '../src/domain/identity/ids';
import { createOpaqueToken } from '../src/server/authentication/auth-security';
import { createPostgresPool } from '../src/server/postgres/pool';

if (existsSync('.env.local')) loadEnvFile('.env.local');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Agent enrollment E2E tests');

test.describe.configure({ mode: 'serial' });
let controllerHandle: string | undefined;

test.afterAll(async () => {
  if (!controllerHandle) return;
  const pool = createPostgresPool(databaseUrl);
  const identities = await pool.query<{ principal_id: string }>(
    `with controller as (
       select c.principal_id from card_handles h
       join ai_cards c on c.card_id = h.card_id
       where h.handle = $1
     )
     select principal_id from controller
     union
     select pc.controlled_principal_id from principal_controllers pc
     join controller on controller.principal_id = pc.controller_principal_id`,
    [controllerHandle],
  );
  await pool.query('delete from principals where principal_id = any($1::uuid[])', [
    identities.rows.map((row) => row.principal_id),
  ]);
  await pool.end();
});

test('creates, claims, displays, and revokes an AI node', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name.startsWith('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
  controllerHandle = `owner_${suffix}`;

  await page.goto('/');
  await page.getByLabel('昵称').fill('AI 控制者');
  await page.getByLabel('@Handle').fill(controllerHandle);
  await page.getByLabel('密码').fill('correct horse 电池 staple');
  await page.getByRole('button', { name: '创建 AI Card', exact: true }).last().click();
  await expect(page).toHaveURL(/\/me\/card$/);

  await page.getByLabel('中文昵称').fill('悠悠助理');
  await page.getByRole('button', { name: '创建邀请' }).click();
  const instruction = page.getByRole('textbox', { name: '完整接入指令' });
  await expect(instruction).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('agent-invitation.png'), fullPage: true });
  const text = await instruction.inputValue();
  const invitationId = text.match(/邀请 ID：([^\n]+)/)?.[1];
  const ticket = text.match(/邀请票据：([^\n]+)/)?.[1];
  expect(invitationId).toBeTruthy();
  expect(ticket).toBeTruthy();

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const claimId = createPrincipalId();
  const claimSecret = createOpaqueToken();
  const machineName = 'yoyoo-agent';
  const signature = sign(null, Buffer.from(agentClaimPayload({
    invitationId: invitationId!, claimId, machineName, publicKey: publicKeySpki,
  })), privateKey).toString('base64url');
  const response = await page.request.post('/api/v1/agent-enrollment/claim', {
    data: {
      invitationId, ticket, claimId, claimSecret, machineName,
      publicKey: publicKeySpki, signature,
    },
  });
  expect(response.status()).toBe(200);
  const claimed = await response.json();
  expect(claimed).toMatchObject({
    displayName: '悠悠助理', machineName, claimStatus: 'claimed', connectionStatus: 'connected',
  });
  expect(claimed.cardId).toMatch(/^AI_[1-9][0-9]{5,}$/u);

  await page.reload();
  const agentPanel = page.getByLabel('AI 身份');
  await expect(agentPanel.getByText('悠悠助理')).toBeVisible();
  await expect(agentPanel.getByText(new RegExp(claimed.cardId, 'u'))).toBeVisible();
  await expect(agentPanel.getByText('已连接')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '完整接入指令' })).toHaveCount(0);

  await page.getByRole('button', { name: '添加节点' }).click();
  await expect(page.getByRole('textbox', { name: '完整接入指令' })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销邀请' })).toBeVisible();
  await page.getByRole('button', { name: '撤销邀请' }).click();
  await expect(page.getByText('邀请已撤销，原指令中的票据不再有效。')).toBeVisible();

  await page.getByRole('button', { name: '撤销节点' }).click();
  const nodeRow = page.getByRole('listitem').filter({ hasText: machineName });
  await expect(nodeRow.getByText('已撤销', { exact: true })).toBeVisible();

  const challenge = await page.request.post('/api/v1/agent-nodes/challenge', {
    data: { nodeId: claimed.nodeId },
  });
  expect(challenge.status()).toBe(409);
});
