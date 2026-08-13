import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';

import { createPostgresPool } from '../src/server/postgres/pool';

if (existsSync('.env.local')) loadEnvFile('.env.local');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Passkey E2E tests');
const e2eOrigin = `http://localhost:${process.env.AICARD_E2E_PORT ?? 4280}`;

test.describe.configure({ mode: 'serial' });

let createdHandle: string | undefined;

test.afterAll(async () => {
  if (!createdHandle) return;
  const pool = createPostgresPool(databaseUrl);
  await pool.query(
    `delete from principals where principal_id in (
       select c.principal_id from card_handles h
       join ai_cards c on c.card_id = h.card_id
       where h.handle = $1
     )`,
    [createdHandle],
  );
  await pool.end();
});

test('creates a password Card, adds Passkeys, and returns through the permanent account', async ({ page }, testInfo) => {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const firstAuthenticator = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const suffix = `${testInfo.project.name.startsWith('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
  const handle = `passkey_${suffix}`;
  const password = 'correct horse 电池 staple';
  createdHandle = handle;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '你的 AI 时代身份' })).toBeVisible();
  await page.getByLabel('昵称').fill('端到端测试身份');
  await page.getByLabel('@Handle').fill(handle);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建 AI Card', exact: true }).last().click();

  await expect(page).toHaveURL(/\/me\/card$/);
  await expect(page.getByRole('article', { name: '端到端测试身份 的私有 Card 背面' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '身份控制' })).toBeVisible();
  await expect(page.getByText('没有可用凭据')).toBeVisible();

  const pool = createPostgresPool(databaseUrl);
  const principal = await pool.query<{ principal_id: string }>(
    `select c.principal_id from card_handles h
     join ai_cards c on c.card_id = h.card_id
     where h.handle = $1 and h.is_current`,
    [handle],
  );
  const createdPrincipalId = principal.rows[0]?.principal_id;
  await pool.end();
  expect(createdPrincipalId).toBeTruthy();

  const privateResponse = await page.request.get('/api/v1/me/card');
  const privateBody = await privateResponse.json();
  expect(privateResponse.status()).toBe(200);
  expect(JSON.stringify(privateBody)).not.toMatch(/public_key|session_hash|challenge_hash/i);

  await page.getByRole('button', { name: '添加 Passkey' }).click();
  await expect(page.getByText('Passkey 01')).toBeVisible();
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'usb',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole('button', { name: '添加 Passkey' }).click();
  await expect(page.getByText('Passkey 02')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).first().click();
  await expect(page.getByText('已撤销', { exact: true })).toBeVisible();
  await client.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: firstAuthenticator.authenticatorId,
  });

  await page.getByRole('button', { name: '退出' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByLabel('AI Card ID 或 @Handle').fill(`@${handle}`);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await expect(page).toHaveURL(/\/me\/card$/);
  await expect(page.getByRole('article', { name: '端到端测试身份 的私有 Card 背面' })).toBeVisible();
});

test('rejects state changes without origin and CSRF proof', async ({ request }) => {
  const originResponse = await request.post('/api/v1/auth/passkey/login/options');
  expect(originResponse.status()).toBe(403);
  expect(await originResponse.json()).toMatchObject({ error: { code: 'AUTHORIZATION_DENIED' } });

  const logoutResponse = await request.post('/api/v1/auth/logout', {
    headers: { origin: e2eOrigin },
  });
  expect(logoutResponse.status()).toBe(403);
  expect(await logoutResponse.json()).toMatchObject({ error: { code: 'AUTHORIZATION_DENIED' } });
});
