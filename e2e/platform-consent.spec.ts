import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';

import { createS256CodeChallenge } from '../src/domain/authorization/scopes';
import { PlatformAuthorizationService } from '../src/server/authorization/authorization-service';
import { IdentityService } from '../src/server/identity-service';
import { PostgresIdentityRepository } from '../src/server/postgres/identity-repository';
import { PostgresPlatformAuthorizationRepository } from '../src/server/postgres/platform-authorization-repository';
import { createPostgresPool } from '../src/server/postgres/pool';

if (existsSync('.env.local')) loadEnvFile('.env.local');

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('DATABASE_URL is required for platform consent E2E tests');

test.describe.configure({ mode: 'serial' });

let createdHandle: string | undefined;
const cleanupHandles: string[] = [];

test.afterAll(async () => {
  if (!cleanupHandles.length) return;
  const pool = createPostgresPool(databaseUrl);
  await pool.query(
    `delete from principals where principal_id in (
       select c.principal_id from card_handles h
       join ai_cards c on c.card_id = h.card_id
       where h.handle = any($1::text[])
     )`,
    [cleanupHandles],
  );
  await pool.end();
});

async function createSignedInCard(page: import('@playwright/test').Page, suffix: string) {
  const handle = `consent_${suffix}_${Date.now().toString(36)}`;
  createdHandle = handle;
  cleanupHandles.push(handle);
  await page.goto('/');
  await page.getByLabel('昵称').fill('平台授权测试');
  await page.getByLabel('@Handle').fill(handle);
  await page.getByLabel('密码').fill('correct horse 电池 staple');
  await page.getByRole('button', { name: '创建 AI Card', exact: true }).last().click();
  await expect(page).toHaveURL(/\/me\/card$/);
}

async function createControlledAgentGrant() {
  if (!createdHandle) throw new Error('A signed-in controller is required');
  const pool = createPostgresPool(databaseUrl);
  try {
    const controller = await pool.query<{ principal_id: string }>(
      `select c.principal_id
       from card_handles h
       join ai_cards c on c.card_id = h.card_id
       where h.handle = $1 and h.is_current`,
      [createdHandle],
    );
    const controllerPrincipalId = controller.rows[0]?.principal_id;
    if (!controllerPrincipalId) throw new Error('Controller identity was not found');

    const agentHandle = `managed_agent_${randomBytes(6).toString('hex')}`;
    const identities = new IdentityService(new PostgresIdentityRepository(pool));
    const agent = await identities.createCard({
      principalType: 'ai',
      controllerPrincipalId,
      displayName: '受控研究助理',
      handle: agentHandle,
    });
    cleanupHandles.push(agentHandle);
    const verifier = randomBytes(32).toString('base64url');
    const authorization = new PlatformAuthorizationService(
      new PostgresPlatformAuthorizationRepository(pool),
    );
    const request = {
      responseType: 'code',
      clientId: 'yoyoo_dev',
      redirectUri: 'http://localhost:4173/auth/aicard/callback',
      scope: 'card.basic card.handle agent.runtime offline_access',
      state: randomBytes(24).toString('base64url'),
      codeChallenge: createS256CodeChallenge(verifier),
      codeChallengeMethod: 'S256',
      principalType: 'ai',
    };
    const approved = await authorization.resolveConsent({
      principalId: controllerPrincipalId,
      subjectPrincipalId: agent.principalId,
      decision: 'approve',
      request,
    });
    const token = await authorization.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: approved.code!,
      codeVerifier: verifier,
      idempotencyKey: `idem_${randomBytes(24).toString('base64url')}`,
    });
    return { agent, token };
  } finally {
    await pool.end();
  }
}

function authorizationUrl(input: { verifier: string; state: string }) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'yoyoo_dev',
    redirect_uri: 'http://localhost:4173/auth/aicard/callback',
    scope: 'card.basic card.handle offline_access',
    state: input.state,
    code_challenge: createS256CodeChallenge(input.verifier),
    code_challenge_method: 'S256',
  });
  return `/authorize?${query}`;
}

test('approves and denies a pre-registered platform request', async ({ page }, testInfo) => {
  await createSignedInCard(page, testInfo.project.name.startsWith('mobile') ? 'm' : 'd');
  await page.route('http://localhost:4173/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<h1>Yoyoo callback</h1>',
  }));

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  await page.goto(authorizationUrl({ verifier, state }));
  await expect(page.getByRole('heading', { name: '允许 Yoyoo 认识你？' })).toBeVisible();
  await expect(page.getByText('昵称、身份类型和头像')).toBeVisible();
  await expect(page.getByText('@Handle')).toBeVisible();
  await expect(page.getByText('保持长期访问（可随时撤销）')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('consent.png'), fullPage: true });
  await page.getByRole('button', { name: '允许访问' }).click();
  await expect(page).toHaveURL(/localhost:4173\/auth\/aicard\/callback/);

  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(state);
  const code = callback.searchParams.get('code');
  expect(code).toMatch(/^ac_[A-Za-z0-9_-]{43}$/);

  const tokenResponse = await page.request.post('/api/v1/token', {
    headers: { 'idempotency-key': `idem_${randomBytes(24).toString('base64url')}` },
    form: {
      grant_type: 'authorization_code',
      client_id: 'yoyoo_dev',
      redirect_uri: 'http://localhost:4173/auth/aicard/callback',
      code: code!,
      code_verifier: verifier,
    },
  });
  expect(tokenResponse.status()).toBe(200);
  const token = await tokenResponse.json() as { access_token: string; refresh_token: string; sub: string };
  expect(token.sub).toMatch(/^sub_[A-Za-z0-9_-]{43}$/);
  expect(token.refresh_token).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);

  const userInfoResponse = await page.request.get('/api/v1/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  expect(userInfoResponse.status()).toBe(200);
  expect(await userInfoResponse.json()).toMatchObject({
    sub: token.sub,
    display_name: '平台授权测试',
    handle: createdHandle,
  });

  await page.goto('/me/card');
  await expect(page.getByRole('heading', { name: '平台授权' })).toBeVisible();
  await expect(page.getByText('Yoyoo', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('platform-grants.png'), fullPage: true });
  await page.getByRole('button', { name: '撤销访问' }).click();
  await expect(page.getByText('平台访问已撤销，关联令牌已失效。')).toBeVisible();

  const revokedUserInfo = await page.request.get('/api/v1/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  expect(revokedUserInfo.status()).toBe(401);
  const revokedRefresh = await page.request.post('/api/v1/token', {
    headers: { 'idempotency-key': `idem_${randomBytes(24).toString('base64url')}` },
    form: {
      grant_type: 'refresh_token',
      client_id: 'yoyoo_dev',
      refresh_token: token.refresh_token,
    },
  });
  expect(revokedRefresh.status()).toBe(400);

  const denyState = randomBytes(24).toString('base64url');
  await page.goto(authorizationUrl({
    verifier: randomBytes(32).toString('base64url'),
    state: denyState,
  }));
  await page.getByRole('button', { name: '拒绝' }).click();
  await expect(page).toHaveURL(/error=access_denied/);
  const deniedCallback = new URL(page.url());
  expect(deniedCallback.searchParams.get('state')).toBe(denyState);
  expect(deniedCallback.searchParams.get('code')).toBeNull();
});

test('rejects platform API calls without required security proof', async ({ request }) => {
  const consent = await request.post('/api/v1/authorize', {
    data: { decision: 'approve', request: {} },
  });
  expect(consent.status()).toBe(403);
  expect(await consent.json()).toMatchObject({ error: { code: 'AUTHORIZATION_DENIED' } });

  const token = await request.post('/api/v1/token', {
    data: { grant_type: 'authorization_code' },
  });
  expect(token.status()).toBe(400);
  expect(await token.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });

  const missingIdempotency = await request.post('/api/v1/token', {
    form: {
      grant_type: 'refresh_token',
      client_id: 'yoyoo_dev',
      refresh_token: `rt_${randomBytes(32).toString('base64url')}`,
    },
  });
  expect(missingIdempotency.status()).toBe(400);
  expect(await missingIdempotency.json()).toMatchObject({ error: { code: 'AUTHORIZATION_DENIED' } });

  const userInfo = await request.get('/api/v1/userinfo');
  expect(userInfo.status()).toBe(401);
  expect(await userInfo.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
});

test('controller manages a controlled AI platform grant from the private Card', async ({ page }, testInfo) => {
  await createSignedInCard(page, testInfo.project.name.startsWith('mobile') ? 'managed_m' : 'managed_d');
  const { agent, token } = await createControlledAgentGrant();

  await page.goto('/me/card');
  await expect(page.getByRole('heading', { name: '平台授权' })).toBeVisible();
  await expect(page.getByText(agent.displayName, { exact: true })).toBeVisible();
  await expect(page.getByText(`@${agent.handle}`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('controlled-ai-grants.png'), fullPage: true });

  await page.getByRole('button', { name: '撤销访问' }).click();
  await expect(page.getByText('平台访问已撤销，关联令牌已失效。')).toBeVisible();
  const revokedUserInfo = await page.request.get('/api/v1/userinfo', {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  expect(revokedUserInfo.status()).toBe(401);
});
