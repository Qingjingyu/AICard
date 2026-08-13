import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';

import { createPostgresPool } from '../src/server/postgres/pool';

if (existsSync('.env.local')) loadEnvFile('.env.local');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for reference product E2E tests');

test.describe.configure({ mode: 'serial' });

const productOrigin = `http://localhost:${process.env.REFERENCE_PRODUCT_E2E_PORT ?? 4281}`;
const handles: string[] = [];

test.afterAll(async () => {
  if (!handles.length) return;
  const pool = createPostgresPool(databaseUrl);
  try {
    const cards = await pool.query<{ card_id: string }>(
      `select c.card_id from card_handles h
       join ai_cards c on c.card_id = h.card_id
       where h.handle = any($1::text[])`,
      [handles],
    );
    const cardIds = cards.rows.map((row) => row.card_id);
    if (cardIds.length) {
      await pool.query(
        `delete from reference_product.members where card_id = any($1::text[])`,
        [cardIds],
      );
    }
    await pool.query(
      `delete from principals where principal_id in (
         select c.principal_id from card_handles h
         join ai_cards c on c.card_id = h.card_id
         where h.handle = any($1::text[])
       )`,
      [handles],
    );
  } finally {
    await pool.end();
  }
});

test('creates one AI Card and returns an established product identity', async ({ page }, testInfo) => {
  const handle = `product_${testInfo.project.name.startsWith('mobile') ? 'm' : 'd'}_${Date.now().toString(36)}`;
  handles.push(handle);

  await page.goto(productOrigin);
  await expect(page.locator('main')).toHaveAttribute('data-state', 'empty');
  await expect(page.getByRole('heading', { name: '连接你的 AI Card' })).toBeVisible();
  await page.getByRole('button', { name: '使用 AI Card 继续' }).click();

  await expect(page.getByRole('heading', { name: '你的 AI 时代身份' })).toBeVisible();
  await page.getByLabel('昵称').fill('跨产品测试用户');
  await page.getByLabel('@Handle').fill(handle);
  await page.getByLabel('密码').fill('correct horse 电池 staple');
  await page.getByRole('button', { name: '创建 AI Card', exact: true }).last().click();

  await expect(page.getByRole('heading', { name: '允许 AI Card Test Platform 认识你？' })).toBeVisible();
  await expect(page.getByText('全局 AI Card ID')).toBeVisible();
  await page.getByRole('button', { name: '允许访问' }).click();

  await expect(page).toHaveURL(`${productOrigin}/?connected=1`);
  await expect(page.locator('main')).toHaveAttribute('data-state', 'success');
  await expect(page.getByRole('heading', { name: '跨产品测试用户' })).toBeVisible();
  await expect(page.getByText('@' + handle)).toBeVisible();
  await expect(page.getByText(/^AI_\d{6,}$/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const pool = createPostgresPool(databaseUrl);
  try {
    const result = await pool.query<{
      card_id: string;
      client_id: string;
      registration_client_id: string;
    }>(
      `select card.card_id, member.client_id, registration.client_id as registration_client_id
       from card_handles handle
       join ai_cards card on card.card_id = handle.card_id
       join account_registration_requests registration on registration.principal_id = card.principal_id
       join reference_product.members member on member.card_id = card.card_id
       where handle.handle = $1`,
      [handle],
    );
    expect(result.rows).toEqual([{
      card_id: expect.stringMatching(/^AI_\d{6,}$/),
      client_id: 'test_client',
      registration_client_id: 'test_client',
    }]);
  } finally {
    await pool.end();
  }
});
