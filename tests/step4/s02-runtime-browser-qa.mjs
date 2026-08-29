import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE || 'playwright';
const { chromium } = require(playwrightPackage);
const baseUrl = process.env.S02_RUNTIME_BASE_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(
  process.env.S02_RUNTIME_EVIDENCE_DIR ||
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-runtime-integration-browser-evidence'
);
const viewports = [
  { name: '320x667', width: 320, height: 667 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 }
];
const failures = [];
const results = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function startPlayableScreen(page, url = baseUrl) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__game));
  const start = page.locator('#btn-start');
  if (await start.isVisible()) await start.click();
  const intro = page.locator('#modal-intro');
  if (await intro.isVisible()) await page.locator('#btn-close-intro').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="s02-runtime-shell"]')?.dataset.runtimeReady === 'true');
  await page.waitForFunction(() => document.querySelector('#runtime-battle-canvas')?.dataset.rendererReady === 'true');
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
}

async function inspectLayout(page, viewport) {
  return page.evaluate(({ width, height }) => {
    const root = document.documentElement;
    const body = document.body;
    const shell = document.querySelector('[data-testid="s02-runtime-shell"]');
    const header = document.querySelector('#hud-top');
    const context = document.querySelector('.runtime-context-bar');
    const nav = document.querySelector('.runtime-bottom-nav');
    const battle = document.querySelector('#battle-wrap');
    const renderer = document.querySelector('#runtime-battle-canvas');
    const tapTargets = [...document.querySelectorAll('button')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 48),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2))
        };
      });
    const criticalSelectors = [
      '#btn-summon',
      '#btn-mute',
      '#runtime-next-target',
      '.runtime-nav-button',
      '.runtime-shortcut'
    ];
    const critical = criticalSelectors.flatMap(selector => [...document.querySelectorAll(selector)]).map(element => {
      const rect = element.getBoundingClientRect();
      return {
        selector: element.id ? `#${element.id}` : element.className,
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2))
      };
    });
    const shellRect = shell.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const battleRect = battle.getBoundingClientRect();
    const rendererRect = renderer.getBoundingClientRect();
    return {
      viewport: { width, height },
      document: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth
      },
      shell: {
        left: Number(shellRect.left.toFixed(2)),
        right: Number(shellRect.right.toFixed(2)),
        width: Number(shellRect.width.toFixed(2)),
        height: Number(shellRect.height.toFixed(2)),
        runtimeReady: shell.dataset.runtimeReady
      },
      headerHeight: Number(header.getBoundingClientRect().height.toFixed(2)),
      contextHeight: Number(context.getBoundingClientRect().height.toFixed(2)),
      battle: {
        width: Number(battleRect.width.toFixed(2)),
        height: Number(battleRect.height.toFixed(2))
      },
      renderer: {
        width: Number(rendererRect.width.toFixed(2)),
        height: Number(rendererRect.height.toFixed(2)),
        ready: renderer.dataset.rendererReady,
        gameFloor: renderer.dataset.gameFloor,
        catCount: renderer.dataset.actualCatCount,
        enemyCount: renderer.dataset.actualEnemyCount
      },
      nav: {
        top: Number(navRect.top.toFixed(2)),
        bottom: Number(navRect.bottom.toFixed(2)),
        height: Number(navRect.height.toFixed(2))
      },
      targetCount: tapTargets.length,
      tooSmall: tapTargets.filter(target => target.width < 43.5 || target.height < 43.5),
      criticalTooSmall: critical.filter(target => target.width < 43.5 || target.height < 43.5),
      game: {
        floor: String(window.__game.floor),
        maxFloor: String(window.__game.maxFloor),
        fieldCats: Array.isArray(window.__game.fieldCats) ? window.__game.fieldCats.length : -1,
        enemies: Array.isArray(window.__game.enemies) ? window.__game.enemies.length : -1
      },
      visibleFloorText: document.querySelector('#hud-floor')?.textContent || '',
      bridge: window.__s02Runtime || null,
      battleRenderer: window.__s02BattleRenderer || null
    };
  }, viewport);
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'dark',
    reducedMotion: 'no-preference'
  });
  await context.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));

  await startPlayableScreen(page);
  await page.waitForTimeout(250);
  const layout = await inspectLayout(page, viewport);

  assert(layout.shell.runtimeReady === 'true', `${viewport.name}: runtime bridge is not ready.`);
  assert(layout.renderer.ready === 'true', `${viewport.name}: actual-state renderer is not ready.`);
  assert(layout.document.scrollWidth <= layout.document.clientWidth + 1, `${viewport.name}: document horizontal overflow.`);
  assert(layout.document.bodyScrollWidth <= layout.document.bodyClientWidth + 1, `${viewport.name}: body horizontal overflow.`);
  assert(layout.shell.left >= -0.5 && layout.shell.right <= viewport.width + 0.5, `${viewport.name}: shell escapes the viewport.`);
  assert(layout.nav.bottom <= viewport.height + 0.5 && layout.nav.bottom >= viewport.height - 2, `${viewport.name}: bottom navigation is not pinned.`);
  assert(layout.battle.height >= 290, `${viewport.name}: battle scene is too shallow.`);
  assert(layout.renderer.width >= layout.battle.width - 2 && layout.renderer.height >= layout.battle.height - 2, `${viewport.name}: renderer does not cover battle scene.`);
  assert(layout.visibleFloorText.includes(layout.game.floor), `${viewport.name}: visible floor does not match actual game floor.`);
  assert(layout.renderer.gameFloor === layout.game.floor, `${viewport.name}: renderer floor does not match actual game floor.`);
  assert(layout.targetCount >= 20, `${viewport.name}: actual control density is unexpectedly low.`);
  assert(layout.criticalTooSmall.length === 0, `${viewport.name}: critical targets below 44px: ${JSON.stringify(layout.criticalTooSmall)}`);
  assert(consoleErrors.length === 0, `${viewport.name}: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `${viewport.name}: page errors: ${pageErrors.join(' | ')}`);
  assert(layout.bridge?.source === 'window.__game', `${viewport.name}: runtime bridge is not sourced from the actual game.`);
  assert(layout.battleRenderer?.source === 'window.__game', `${viewport.name}: renderer is not sourced from the actual game.`);

  const screenshot = path.join(outputDir, `s02-root-${viewport.name}.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'normal', viewport, layout, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await context.close();
}

async function runInteraction(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  await context.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));

  await startPlayableScreen(page);
  const beforeCats = await page.evaluate(() => window.__game.fieldCats.length);
  await page.locator('#btn-summon').click();
  await page.waitForFunction(before => window.__game.fieldCats.length > before, beforeCats);
  const afterCats = await page.evaluate(() => window.__game.fieldCats.length);
  assert(afterCats > beforeCats, 'Interaction: summon did not change actual game state.');

  await page.locator('[data-runtime-action="agency"]').first().click();
  await page.waitForSelector('.sheet.open');
  assert(await page.locator('.sheet.open').isVisible(), 'Interaction: agency did not open the real existing sheet.');
  const close = page.locator('.sheet.open .close').last();
  if (await close.count()) await close.click();

  const commerce = page.locator('.runtime-nav-button[data-runtime-action="commerce"]');
  await commerce.click();
  assert(await commerce.getAttribute('aria-current') === 'page', 'Interaction: commerce navigation did not become current.');
  const scrollTop = await page.locator('#runtime-scroll').evaluate(element => element.scrollTop);
  assert(scrollTop > 0, 'Interaction: commerce navigation did not move to the actual merchant section.');

  await page.locator('.runtime-nav-button[data-runtime-action="events"]').click();
  assert((await page.locator('#runtime-toast').textContent()).includes('制作中'), 'Interaction: unavailable events control did not expose an explicit pending state.');

  const actualState = await page.evaluate(() => ({
    gameCats: window.__game.fieldCats.length,
    renderedCats: Number(document.querySelector('#runtime-battle-canvas').dataset.actualCatCount),
    rendererFloor: document.querySelector('#runtime-battle-canvas').dataset.gameFloor,
    gameFloor: String(window.__game.floor)
  }));
  assert(actualState.renderedCats === actualState.gameCats, 'Interaction: rendered cat count does not mirror actual game state.');
  assert(actualState.rendererFloor === actualState.gameFloor, 'Interaction: renderer floor diverged from actual game state.');
  assert(consoleErrors.length === 0, `Interaction: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `Interaction: page errors: ${pageErrors.join(' | ')}`);

  const screenshot = path.join(outputDir, 's02-root-390x844-interaction.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'interaction', actualState, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await context.close();
}

async function runLargeText(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  await context.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await startPlayableScreen(page, `${baseUrl}?largeText=1`);
  const evidence = await page.evaluate(() => {
    const root = document.documentElement;
    const summon = document.querySelector('#btn-summon').getBoundingClientRect();
    const nav = document.querySelector('.runtime-bottom-nav').getBoundingClientRect();
    return {
      classApplied: document.body.classList.contains('runtime-large-text'),
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      summonVisible: summon.width >= 44 && summon.height >= 44,
      navBottom: nav.bottom,
      viewportHeight: innerHeight
    };
  });
  assert(evidence.classApplied, 'Large text: simulation class is not applied.');
  assert(evidence.horizontalOverflow <= 1, 'Large text: horizontal overflow detected.');
  assert(evidence.summonVisible, 'Large text: primary summon action is not usable.');
  assert(Math.abs(evidence.navBottom - evidence.viewportHeight) <= 2, 'Large text: bottom navigation is not pinned.');
  assert(consoleErrors.length === 0, `Large text: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `Large text: page errors: ${pageErrors.join(' | ')}`);
  const screenshot = path.join(outputDir, 's02-root-390x844-large-text.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'large-text-browser-simulation', evidence, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await context.close();
}

async function runReducedMotion(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
    reducedMotion: 'reduce'
  });
  await context.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await startPlayableScreen(page);
  const evidence = await page.evaluate(() => {
    const target = document.querySelector('.tf-cat');
    return {
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      towerCatAnimation: target ? getComputedStyle(target).animationName : 'none',
      rendererReady: document.querySelector('#runtime-battle-canvas').dataset.rendererReady
    };
  });
  assert(evidence.mediaMatches, 'Reduced motion: media query does not match.');
  assert(evidence.towerCatAnimation === 'none', `Reduced motion: tower cat loop remains active (${evidence.towerCatAnimation}).`);
  assert(evidence.rendererReady === 'true', 'Reduced motion: actual-state renderer is not ready.');
  assert(consoleErrors.length === 0, `Reduced motion: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `Reduced motion: page errors: ${pageErrors.join(' | ')}`);
  const screenshot = path.join(outputDir, 's02-root-390x844-reduced-motion.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'reduced-motion', evidence, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await context.close();
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) await runViewport(browser, viewport);
  await runInteraction(browser);
  await runLargeText(browser);
  await runReducedMotion(browser);
} finally {
  await browser.close();
}

const report = {
  verdict: failures.length ? 'FAIL_S02_RUNTIME_BROWSER_INTEGRATION' : 'PASS_S02_RUNTIME_BROWSER_INTEGRATION',
  baseUrl,
  generatedAt: new Date().toISOString(),
  playwrightPackage,
  actualEntryPoint: '/',
  sourceOfTruth: 'window.__game',
  requiredViewports: viewports,
  results,
  failures
};
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
