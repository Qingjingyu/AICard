import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { expect, test } from '@playwright/test';

import { createPostgresPool } from '../src/server/postgres/pool';

if (existsSync('.env.local')) loadEnvFile('.env.local');

test.describe.configure({ mode: 'serial' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Card view E2E tests');

const fixtures = {
  'desktop-chromium': {
    principalId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a10',
    cardId: 'aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW',
    handle: 'yoyoo_desktop',
  },
  'mobile-chromium': {
    principalId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a11',
    cardId: 'aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VX',
    handle: 'yoyoo_mobile',
  },
} as const;

let fixture: (typeof fixtures)[keyof typeof fixtures];
let pool: ReturnType<typeof createPostgresPool>;

test.beforeAll(async ({}, testInfo) => {
  fixture = fixtures[testInfo.project.name as keyof typeof fixtures];
  if (!fixture) throw new Error(`No Card fixture for project ${testInfo.project.name}`);
  pool = createPostgresPool(databaseUrl);

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from principals where principal_id = $1', [fixture.principalId]);
    await client.query(
      'insert into principals (principal_id, principal_type) values ($1, $2)',
      [fixture.principalId, 'human'],
    );
    await client.query(
      `insert into ai_cards (card_id, principal_id, display_name, bio)
       values ($1, $2, $3, $4)`,
      [fixture.cardId, fixture.principalId, '苏白', 'AI 时代的身份与协作通行证'],
    );
    await client.query(
      'insert into card_handles (handle, card_id) values ($1, $2)',
      [fixture.handle, fixture.cardId],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
});

test.afterAll(async () => {
  if (!pool || !fixture) return;
  await pool.query('delete from principals where principal_id = $1', [fixture.principalId]);
  await pool.end();
});

test('public Card page renders only public identity fields', async ({ page }) => {
  const response = await page.goto(`/card/${fixture.cardId}`);

  expect(response?.status()).toBe(200);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main')).toHaveAttribute('data-state', 'success');
  await expect(page.getByRole('heading', { name: '苏白' })).toBeVisible();
  await expect(page.getByText(`@${fixture.handle}`)).toBeVisible();
  await expect(page.getByText(fixture.cardId)).toBeVisible();
  await expect(page.getByText('控制者')).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test('public Card API and not-found page preserve visibility boundaries', async ({ page, request }) => {
  const apiResponse = await request.get(`/api/v1/cards/${fixture.cardId}`);
  const body = await apiResponse.json();

  expect(apiResponse.status()).toBe(200);
  expect(body).toMatchObject({ card_id: fixture.cardId, display_name: '苏白' });
  expect(JSON.stringify(body)).not.toMatch(/principal_id|controller|token|secret/i);

  await page.goto('/card/aic_00000000000000000000000000');
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main')).toHaveAttribute('data-state', 'empty');
  await expect(page.getByRole('heading', { name: '没有找到这张 AI Card' })).toBeVisible();
});

test('public Card matches the approved visual baseline', async ({ page }) => {
  await page.goto(`/card/${fixture.cardId}`);
  await expect(page.getByRole('heading', { name: '苏白' })).toBeVisible();
  await expect(page).toHaveScreenshot('card-public.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixels: 100,
  });
});
