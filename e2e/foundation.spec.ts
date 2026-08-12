import { expect, test } from '@playwright/test';

const states = [
  ['success', '/?state=success', '工程基础已就绪'],
  ['empty', '/?state=empty', '还没有 AI Card'],
  ['loading', '/?state=loading', '正在确认服务状态'],
  ['error', '/?state=error', '身份服务暂不可用'],
] as const;

for (const [state, url, heading] of states) {
  test(`${state} state is visible without horizontal overflow`, async ({ page }) => {
    await page.goto(url);

    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('main')).toHaveAttribute('data-state', state);
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}

test('success state matches the approved foundation baseline', async ({ page }) => {
  await page.goto('/?state=success');
  await expect(page.getByRole('heading', { name: '工程基础已就绪' })).toBeVisible();
  await expect(page).toHaveScreenshot('foundation-success.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixels: 100,
  });
});

test('foundation responses include baseline security headers', async ({ page }) => {
  const response = await page.goto('/?state=success');

  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
});
