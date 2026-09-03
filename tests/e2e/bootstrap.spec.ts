import { expect, test } from '@playwright/test';

test('boots a candidate-v3-bound mobile tower combat loop without browser errors', async ({
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
  await expect(page.getByRole('heading', { name: /F・第\d+区画/ })).toBeVisible();
  await expect(page.getByTestId('game-container').locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__CATS_TOWER_V2__));
  await expect(
    page.getByText('candidate-v3 / engine-v2 / combat値は仮'),
  ).toBeVisible();
  await expect(page.getByText(/WAVE/)).toHaveCount(0);

  const first = await page.evaluate(() => {
    window.__CATS_TOWER_V2__.pause();
    window.__CATS_TOWER_V2__.restart('42', { startFloor: '1' });
    window.__CATS_TOWER_V2__.pause();
    return window.__CATS_TOWER_V2__.advanceForTest(30_000);
  });

  expect(BigInt(first.kills)).toBeGreaterThan(0n);
  expect(BigInt(first.coins)).toBeGreaterThan(0n);
  expect(BigInt(first.floor)).toBeGreaterThan(1n);
  expect(first.fixedStepMs).toBe(50);
  expect(first.authority.candidatePath).toBe('simulation/candidate-v3.json');
  expect(first.authority.towerEnginePath).toBe(
    'simulation/engine-v2/tower.mjs',
  );
  expect(first.cats.map((cat) => [cat.id, cat.role])).toEqual([
    ['character.launch.001', 'frontline-control'],
    ['character.launch.002', 'ranged-anti-air'],
    ['character.launch.003', 'healing-support'],
    ['character.launch.004', 'runner-backline-disruption'],
  ]);

  const floorTen = await page.evaluate(() =>
    window.__CATS_TOWER_V2__.restart('browser-floor-parity', {
      startFloor: '10',
    }),
  );
  expect(floorTen.tower).toMatchObject({
    floor: '10',
    district: '1',
    districtId: 'tower.district.001',
    cycleId: 'tower.cycle.000001',
    milestoneId: 'tower.milestone.floor.10',
    boss: {
      kind: 'district',
      id: 'tower.boss.d01.kagetsubasa',
    },
    modifiers: ['tower.modifier.flying', 'tower.modifier.haste'],
    hp: { representation: 'expanded-integer', value: '156' },
    attack: { representation: 'expanded-integer', value: '16' },
    coin: { representation: 'expanded-integer', value: '29' },
  });

  const second = await page.evaluate(() => {
    window.__CATS_TOWER_V2__.restart('42', { startFloor: '1' });
    window.__CATS_TOWER_V2__.pause();
    return window.__CATS_TOWER_V2__.advanceForTest(30_000);
  });

  expect(second).toEqual(first);

  const levelResult = await page.evaluate(() => {
    window.__CATS_TOWER_V2__.restart('level-test', {
      startCoins: '25',
    });
    return window.__CATS_TOWER_V2__.levelUp();
  });
  expect(levelResult.partyLevel).toBe('2');
  expect(levelResult.coins).toBe('0');

  await page.evaluate(() => {
    window.__CATS_TOWER_V2__.restart('42', { startFloor: '1' });
    window.__CATS_TOWER_V2__.pause();
    window.__CATS_TOWER_V2__.advanceForTest(30_000);
  });

  const readVisualIntegrity = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const fill = document.querySelector(
        '[data-testid="enemy-health-fill"]',
      );
      const track = fill?.parentElement;

      if (!(canvas instanceof HTMLCanvasElement)) {
        return null;
      }

      const context = canvas.getContext('2d');
      if (!context || canvas.width <= 0 || canvas.height <= 0) {
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
      const snapshot = window.__CATS_TOWER_V2__.getSnapshot();
      const current = BigInt(snapshot.enemy.hp);
      const maximum = BigInt(snapshot.enemy.maxHp);
      const expectedEnemyRatio =
        maximum > 0n
          ? Number((current * 10_000n) / maximum) / 10_000
          : 0;

      return {
        nonBackgroundRatio:
          samples > 0 ? nonBackgroundSamples / samples : 0,
        brightRatio: samples > 0 ? brightSamples / samples : 0,
        renderedEnemyRatio:
          fillRect && trackRect && trackRect.width > 0
            ? fillRect.width / trackRect.width
            : Number.NaN,
        expectedEnemyRatio,
      };
    });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  await expect
    .poll(async () => (await readVisualIntegrity())?.nonBackgroundRatio ?? 0, {
      timeout: 5_000,
    })
    .toBeGreaterThan(0.2);
  await expect
    .poll(async () => (await readVisualIntegrity())?.brightRatio ?? 0, {
      timeout: 5_000,
    })
    .toBeGreaterThan(0.08);
  await expect
    .poll(
      async () => {
        const integrity = await readVisualIntegrity();
        if (!integrity) {
          return Number.POSITIVE_INFINITY;
        }
        return Math.abs(
          integrity.renderedEnemyRatio - integrity.expectedEnemyRatio,
        );
      },
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(0.02);

  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const topHud = document.querySelector('[data-testid="top-hud"]');
    const heading = document.querySelector('h1');
    const controls = document.querySelector('.controls');

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      canvas: canvas?.getBoundingClientRect().toJSON(),
      topHud: topHud?.getBoundingClientRect().toJSON(),
      heading: heading?.getBoundingClientRect().toJSON(),
      controls: controls?.getBoundingClientRect().toJSON(),
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.canvas?.width ?? 0).toBeGreaterThan(200);
  expect(layout.canvas?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    layout.innerWidth + 1,
  );
  expect(layout.topHud?.top ?? -1).toBeGreaterThanOrEqual(0);
  expect(layout.heading?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(32);
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
