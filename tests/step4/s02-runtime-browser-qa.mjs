import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const baseUrl = process.env.S02_RUNTIME_BASE_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.S02_RUNTIME_EVIDENCE_DIR ||
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-actual-root-visual-repair-browser-evidence');
const viewports = [
  { name: '320x667', width: 320, height: 667 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 }
];
const failures = [];
const results = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

async function boot(page, url = baseUrl) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__game));
  if (await page.locator('#btn-start').isVisible()) await page.locator('#btn-start').click();
  if (await page.locator('#modal-intro').isVisible()) await page.locator('#btn-close-intro').click();
  await page.waitForFunction(() => {
    const shell = document.querySelector('[data-testid="s02-runtime-shell"]');
    const canvas = document.querySelector('#runtime-battle-canvas');
    return shell?.dataset.runtimeReady === 'true' &&
      shell?.dataset.visualLayerReady === 'true' &&
      canvas?.dataset.rendererReady === 'true';
  });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
}

async function summonTo(page, target = 4) {
  const before = await page.evaluate(() => window.__game.fieldCats.length);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.evaluate(minimum => window.__game.fieldCats.length >= minimum, target)) break;
    await page.locator('#btn-summon').click();
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(minimum => window.__game.fieldCats.length >= minimum, Math.min(target, before + 1));
  await page.waitForTimeout(450);
  const state = await page.evaluate(() => ({
    after: window.__game.fieldCats.length,
    floor: window.__game.floor,
    enemies: window.__game.enemies.length
  }));
  return { before, ...state };
}

async function inspect(page, viewport) {
  return page.evaluate(({ width, height }) => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const root = document.documentElement;
    const shell = document.querySelector('[data-testid="s02-runtime-shell"]');
    const battle = rect('#battle-wrap');
    const nav = rect('.runtime-bottom-nav');
    const canvas = document.querySelector('#runtime-battle-canvas');
    const party = rect('[data-testid="runtime-party-dock"]');
    const critical = ['#btn-summon', '#btn-mute', '#runtime-next-target', '.runtime-nav-button', '.runtime-shortcut', '.runtime-party-slot']
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .map(element => {
        const box = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40), width: box.width, height: box.height };
      });
    const resources = ['#hud-coins', '#hud-sparkles', '.runtime-resource-card b']
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .map(element => ({
        text: element.textContent.trim(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fontSize: parseFloat(getComputedStyle(element).fontSize)
      }));
    return {
      viewport: { width, height },
      overflow: root.scrollWidth - root.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      battle: { width: battle.width, height: battle.height },
      nav: { bottom: nav.bottom, height: nav.height },
      shell: {
        ready: shell.dataset.runtimeReady,
        visual: shell.dataset.visualLayerReady,
        observer: shell.dataset.actualEventObserver,
        causality: shell.dataset.visualCausalityReady
      },
      canvas: {
        ready: canvas.dataset.rendererReady,
        floor: canvas.dataset.gameFloor,
        cats: Number(canvas.dataset.actualCatCount),
        enemies: Number(canvas.dataset.actualEnemyCount),
        partySlots: Number(canvas.dataset.partySlotCount),
        repair: canvas.dataset.visualRepairVersion
      },
      game: {
        floor: String(window.__game.floor),
        cats: window.__game.fieldCats.length,
        enemies: window.__game.enemies.length
      },
      party: {
        count: document.querySelectorAll('.runtime-party-slot').length,
        withinBattle: party.left >= battle.left - 1 && party.right <= battle.right + 1 && party.top >= battle.top - 1 && party.bottom <= battle.bottom + 1
      },
      objective: document.querySelector('#runtime-objective-title')?.textContent || '',
      feed: document.querySelector('#runtime-feed-text')?.textContent || '',
      causalityCells: document.querySelector('[data-testid="runtime-causality-strip"]')?.children.length || 0,
      resourceValues: resources,
      criticalTooSmall: critical.filter(item => item.width < 43.5 || item.height < 43.5),
      bridge: window.__s02Runtime,
      renderer: window.__s02BattleRenderer
    };
  }, viewport);
}

function validate(layout, viewport, consoleErrors, pageErrors) {
  assert(layout.overflow <= 1 && layout.bodyOverflow <= 1, `${viewport.name}: horizontal overflow.`);
  assert(Math.abs(layout.nav.bottom - viewport.height) <= 2, `${viewport.name}: bottom navigation not pinned.`);
  assert(layout.battle.height >= 330, `${viewport.name}: battle scene too shallow.`);
  assert(layout.shell.ready === 'true' && layout.shell.visual === 'true', `${viewport.name}: runtime or visual layer not ready.`);
  assert(layout.shell.observer === 'true' && layout.shell.causality === 'true', `${viewport.name}: event/causality bridge missing.`);
  assert(layout.canvas.ready === 'true' && layout.canvas.repair === 's02-visual-repair-round-001', `${viewport.name}: renderer repair not ready.`);
  assert(layout.canvas.floor === layout.game.floor, `${viewport.name}: rendered floor differs from actual game.`);
  assert(layout.canvas.cats === layout.game.cats && layout.canvas.enemies === layout.game.enemies, `${viewport.name}: rendered unit counts differ from actual game.`);
  assert(layout.party.count === 4 && layout.canvas.partySlots === 4 && layout.party.withinBattle, `${viewport.name}: four-slot party identity invalid.`);
  assert(layout.objective.length > 0 && layout.feed.length > 0 && layout.causalityCells === 3, `${viewport.name}: battle causality text missing.`);
  assert(layout.criticalTooSmall.length === 0, `${viewport.name}: critical targets under 44px: ${JSON.stringify(layout.criticalTooSmall)}`);
  assert(layout.resourceValues.every(item => item.text && item.scrollWidth <= item.clientWidth + 1 && item.fontSize >= 9), `${viewport.name}: resource value clipping/readability failure: ${JSON.stringify(layout.resourceValues)}`);
  assert(layout.bridge?.source === 'window.__game' && layout.renderer?.source === 'window.__game', `${viewport.name}: actual game is not the display authority.`);
  assert(consoleErrors.length === 0, `${viewport.name}: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `${viewport.name}: page errors: ${pageErrors.join(' | ')}`);
}

async function viewportRun(browser, viewport) {
  const browserContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'ja-JP', reducedMotion: 'no-preference' });
  await browserContext.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await browserContext.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await boot(page);
  const hydration = await summonTo(page, 4);
  const layout = await inspect(page, viewport);
  validate(layout, viewport, consoleErrors, pageErrors);
  const screenshot = path.join(outputDir, `s02-root-${viewport.name}.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'normal-after-explicit-summon', viewport, hydration, layout, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await browserContext.close();
}

async function interactionRun(browser) {
  const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  await browserContext.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await browserContext.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await boot(page);
  await summonTo(page, 4);
  const before = await page.evaluate(() => window.__game.fieldCats.length);
  await page.locator('#btn-summon').click();
  await page.waitForFunction(value => window.__game.fieldCats.length > value, before);
  await page.locator('.runtime-party-slot').first().click();
  await page.waitForSelector('.sheet.open');
  const close = page.locator('.sheet.open .close').last();
  if (await close.count()) await close.click();
  const commerce = page.locator('.runtime-nav-button[data-runtime-action="commerce"]');
  await commerce.click();
  await page.waitForFunction(() => document.querySelector('#runtime-scroll')?.scrollTop > 0);
  await page.locator('.runtime-nav-button[data-runtime-action="events"]').click();
  assert((await page.locator('#runtime-toast').textContent()).includes('制作中'), 'Interaction: pending event state not explicit.');
  await page.locator('.runtime-nav-button[data-runtime-action="battle"]').click();
  await page.waitForFunction(() => document.querySelector('#runtime-scroll')?.scrollTop === 0);
  const state = await page.evaluate(() => ({
    gameCats: window.__game.fieldCats.length,
    renderedCats: Number(document.querySelector('#runtime-battle-canvas').dataset.actualCatCount),
    partySlots: document.querySelectorAll('.runtime-party-slot').length,
    feed: document.querySelector('#runtime-feed-text').textContent
  }));
  assert(state.gameCats === state.renderedCats && state.partySlots === 4 && state.feed.length > 0, 'Interaction: actual state/party/feed divergence.');
  assert(consoleErrors.length === 0 && pageErrors.length === 0, `Interaction errors: ${consoleErrors.join(' | ')} ${pageErrors.join(' | ')}`);
  const screenshot = path.join(outputDir, 's02-root-390x844-interaction.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'actual-interaction', state, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await browserContext.close();
}

async function alternateRun(browser, mode) {
  const reduced = mode === 'reduced-motion';
  const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await browserContext.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await browserContext.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await boot(page, mode === 'large-text' ? `${baseUrl}?largeText=1` : baseUrl);
  await summonTo(page, 4);
  const evidence = await page.evaluate(({ reduced }) => {
    const root = document.documentElement;
    const nav = document.querySelector('.runtime-bottom-nav').getBoundingClientRect();
    const party = document.querySelector('[data-testid="runtime-party-dock"]').getBoundingClientRect();
    const battle = document.querySelector('#battle-wrap').getBoundingClientRect();
    return {
      largeText: document.body.classList.contains('runtime-large-text'),
      reducedMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      overflow: root.scrollWidth - root.clientWidth,
      navPinned: Math.abs(nav.bottom - innerHeight) <= 2,
      partyWithinBattle: party.left >= battle.left - 1 && party.right <= battle.right + 1 && party.bottom <= battle.bottom + 1,
      partySlots: document.querySelectorAll('.runtime-party-slot').length,
      rendererReady: document.querySelector('#runtime-battle-canvas').dataset.rendererReady,
      objective: document.querySelector('#runtime-objective-title').textContent,
      feed: document.querySelector('#runtime-feed-text').textContent,
      expectedReduced: reduced
    };
  }, { reduced });
  assert(evidence.overflow <= 1 && evidence.navPinned && evidence.partyWithinBattle && evidence.partySlots === 4, `${mode}: layout failure.`);
  assert(evidence.rendererReady === 'true' && evidence.objective && evidence.feed, `${mode}: state information missing.`);
  assert(reduced ? evidence.reducedMatches : evidence.largeText, `${mode}: requested browser mode not active.`);
  assert(consoleErrors.length === 0 && pageErrors.length === 0, `${mode}: browser errors.`);
  const screenshot = path.join(outputDir, `s02-root-390x844-${mode}.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode, evidence, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await browserContext.close();
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) await viewportRun(browser, viewport);
  await interactionRun(browser);
  await alternateRun(browser, 'large-text');
  await alternateRun(browser, 'reduced-motion');
} finally {
  await browser.close();
}

const report = {
  verdict: failures.length ? 'FAIL_S02_ACTUAL_ROOT_VISUAL_REPAIR_BROWSER' : 'PASS_S02_ACTUAL_ROOT_VISUAL_REPAIR_BROWSER',
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  route: '/',
  source: 'window.__game',
  eventSource: 'non-consuming window.__game.emit observation',
  visualRepairVersion: 's02-visual-repair-round-001',
  normalScreenshotState: 'after explicit actual summon-button interaction',
  resultCount: results.length,
  results,
  failures,
  productionChanged: false,
  physicalIPhone: 'NOT_VERIFIED'
};
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
