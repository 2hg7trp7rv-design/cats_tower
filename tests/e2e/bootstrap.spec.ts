import { expect, test } from '@playwright/test';

test('boots a deterministic mobile combat loop without browser errors', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '第1区画' })).toBeVisible();
  await expect(page.getByTestId('game-container').locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__CATS_TOWER_V2__));

  const first = await page.evaluate(() => {
    window.__CATS_TOWER_V2__.pause();
    window.__CATS_TOWER_V2__.restart(42);
    window.__CATS_TOWER_V2__.pause();
    return window.__CATS_TOWER_V2__.advanceForTest(30_000);
  });

  expect(first.kills).toBeGreaterThan(0);
  expect(first.coins).toBeGreaterThan(0);
  expect(first.wave).toBe(first.kills + 1);

  const second = await page.evaluate(() => {
    window.__CATS_TOWER_V2__.restart(42);
    window.__CATS_TOWER_V2__.pause();
    return window.__CATS_TOWER_V2__.advanceForTest(30_000);
  });

  expect(second).toEqual(first);

  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const topHud = document.querySelector('[data-testid="top-hud"]');
    const controls = document.querySelector('.controls');

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      canvas: canvas?.getBoundingClientRect().toJSON(),
      topHud: topHud?.getBoundingClientRect().toJSON(),
      controls: controls?.getBoundingClientRect().toJSON(),
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.canvas?.width ?? 0).toBeGreaterThan(200);
  expect(layout.canvas?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    layout.innerWidth + 1,
  );
  expect(layout.topHud?.top ?? -1).toBeGreaterThanOrEqual(0);
  expect(layout.controls?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    layout.innerHeight + 1,
  );

  await page.screenshot({
    path: testInfo.outputPath('bootstrap.png'),
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
