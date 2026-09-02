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


  const visualIntegrity = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const fill = document.querySelector(
      '[data-testid="enemy-health-fill"]',
    );
    const track = fill?.parentElement;

    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }

    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data;
    let samples = 0;
    let nonBackgroundSamples = 0;
    let brightSamples = 0;

    for (let index = 0; index + 2 < pixels.length; index += 400) {
      const red = pixels[index]!;
      const green = pixels[index + 1]!;
      const blue = pixels[index + 2]!;
      samples += 1;

      if (
        Math.abs(red - 7) +
          Math.abs(green - 19) +
          Math.abs(blue - 28) >
        24
      ) {
        nonBackgroundSamples += 1;
      }

      if (red + green + blue > 90) {
        brightSamples += 1;
      }
    }

    const fillRect = fill?.getBoundingClientRect();
    const trackRect = track?.getBoundingClientRect();
    const expectedEnemyRatio =
      window.__CATS_TOWER_V2__.getSnapshot().enemy.hp /
      window.__CATS_TOWER_V2__.getSnapshot().enemy.maxHp;

    return {
      nonBackgroundRatio: nonBackgroundSamples / samples,
      brightRatio: brightSamples / samples,
      renderedEnemyRatio:
        fillRect && trackRect && trackRect.width > 0
          ? fillRect.width / trackRect.width
          : Number.NaN,
      expectedEnemyRatio,
    };
  });

  expect(visualIntegrity).not.toBeNull();
  expect(visualIntegrity?.nonBackgroundRatio ?? 0).toBeGreaterThan(0.2);
  expect(visualIntegrity?.brightRatio ?? 0).toBeGreaterThan(0.08);
  expect(
    Math.abs(
      (visualIntegrity?.renderedEnemyRatio ?? Number.NaN) -
        (visualIntegrity?.expectedEnemyRatio ?? Number.NaN),
    ),
  ).toBeLessThanOrEqual(0.02);

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
