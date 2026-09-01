import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const baseUrl = process.env.S02_RUNTIME_BASE_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.S02_RUNTIME_EVIDENCE_DIR ||
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-actual-root-visual-repair-browser-evidence');

const visualVersion = 's02-responsive-repair-round-002';
const responsiveStrategy = 'reference-width-reflow-safe-area';
const viewports = [
  { name: '320x568-stress', width: 320, height: 568 },
  { name: '320x667', width: 320, height: 667 },
  { name: '360x800', width: 360, height: 800 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 }
];

const failures = [];
const results = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

async function boot(page, url = baseUrl) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__game));
  if (await page.locator('#btn-start').isVisible()) await page.locator('#btn-start').click();
  if (await page.locator('#modal-intro').isVisible()) await page.locator('#btn-close-intro').click();
  await page.waitForFunction(({ visualVersion, responsiveStrategy }) => {
    const shell = document.querySelector('[data-testid="s02-runtime-shell"]');
    const canvas = document.querySelector('#runtime-battle-canvas');
    return shell?.dataset.runtimeReady === 'true' &&
      shell?.dataset.visualLayerReady === 'true' &&
      shell?.dataset.responsiveStrategy === responsiveStrategy &&
      canvas?.dataset.rendererReady === 'true' &&
      canvas?.dataset.visualRepairVersion === visualVersion;
  }, { visualVersion, responsiveStrategy });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
}

async function summonTo(page, target = 4) {
  const before = await page.evaluate(() => window.__game.fieldCats.length);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await page.evaluate(minimum => window.__game.fieldCats.length >= minimum, target)) break;
    await page.locator('#btn-summon').click();
    await page.waitForTimeout(170);
  }
  await page.waitForFunction(minimum => window.__game.fieldCats.length >= minimum, Math.min(target, before + 1));
  await page.waitForTimeout(550);
  const actual = await page.evaluate(() => ({
    after: window.__game.fieldCats.length,
    floor: window.__game.floor,
    enemies: window.__game.enemies.length
  }));
  return { before, ...actual };
}

async function inspect(page, viewport, minimumFont = 11) {
  return page.evaluate(({ width, height, minimumFont, visualVersion, responsiveStrategy }) => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const root = document.documentElement;
    const shell = document.querySelector('[data-testid="s02-runtime-shell"]');
    const canvas = document.querySelector('#runtime-battle-canvas');
    const battle = box('#battle-wrap');
    const party = box('[data-testid="runtime-party-dock"]');
    const nav = box('.runtime-bottom-nav');
    const scroll = box('#runtime-scroll');

    const targetSelectors = [
      '#btn-summon', '#btn-mute', '#runtime-next-target', '.runtime-profile',
      '.runtime-nav-button', '.runtime-party-slot', '.runtime-action', '#btn-dawn'
    ];
    const touchTargets = targetSelectors
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 48),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2))
        };
      });

    const textSelectors = [
      '.runtime-profile-copy strong', '.runtime-profile-copy small',
      '#hud-coins', '#hud-sparkles', '.runtime-resource-card b',
      '.runtime-context-copy h1', '.runtime-context-copy p',
      '.runtime-next-target span', '.runtime-next-target strong', '.runtime-next-target small',
      '.runtime-encounter-kind', '.runtime-encounter-copy strong', '.runtime-encounter-copy small', '.runtime-encounter-value',
      '.runtime-battle-counts', '#runtime-feed-text',
      '.runtime-party-dock-heading strong', '.runtime-party-dock-heading small', '.runtime-party-dock-heading b',
      '.runtime-party-slot-copy strong', '.runtime-party-slot-copy small', '.runtime-party-slot-state',
      '.runtime-causality-strip span', '.runtime-causality-strip strong', '.runtime-causality-strip small',
      '#hud-dps', '#hud-weapon', '#hud-income', '#summon-sub', '#btn-summon .sum-label',
      '.runtime-action b', '#btn-dawn', '.runtime-support-heading strong', '.runtime-support-heading small',
      '.runtime-nav-button b'
    ];
    const visibleText = textSelectors
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
      })
      .map(element => ({
        text: element.textContent.trim().slice(0, 60),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        width: Number(element.getBoundingClientRect().width.toFixed(2)),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }));

    const resources = ['#hud-coins', '#hud-sparkles', '.runtime-resource-card b']
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .map(element => ({
        text: element.textContent.trim(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
      }));

    return {
      viewport: { width, height },
      overflow: root.scrollWidth - root.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      scroll: { height: scroll.height, scrollHeight: document.querySelector('#runtime-scroll').scrollHeight },
      battle: { top: battle.top, bottom: battle.bottom, width: battle.width, height: battle.height },
      party: {
        top: party.top,
        bottom: party.bottom,
        width: party.width,
        height: party.height,
        count: document.querySelectorAll('.runtime-party-slot').length,
        followsBattle: party.top >= battle.bottom - 1 && party.left >= battle.left - 1 && party.right <= battle.right + 1,
        placement: document.querySelector('[data-testid="runtime-party-dock"]')?.dataset.placement || ''
      },
      nav: { top: nav.top, bottom: nav.bottom, height: nav.height },
      shell: {
        ready: shell.dataset.runtimeReady,
        visual: shell.dataset.visualLayerReady,
        observer: shell.dataset.actualEventObserver,
        causality: shell.dataset.visualCausalityReady,
        responsiveStrategy: shell.dataset.responsiveStrategy,
        layoutWidth: shell.dataset.layoutWidth,
        layoutHeight: shell.dataset.layoutHeight,
        layoutAspect: shell.dataset.layoutAspect
      },
      canvas: {
        ready: canvas.dataset.rendererReady,
        floor: canvas.dataset.gameFloor,
        cats: Number(canvas.dataset.actualCatCount),
        enemies: Number(canvas.dataset.actualEnemyCount),
        partySlotCount: Number(canvas.dataset.partySlotCount),
        visualCausalityReady: canvas.dataset.visualCausalityReady,
        responsiveStrategy: canvas.dataset.responsiveStrategy,
        repair: canvas.dataset.visualRepairVersion
      },
      game: {
        floor: String(window.__game.floor),
        cats: window.__game.fieldCats.length,
        enemies: window.__game.enemies.length
      },
      objective: document.querySelector('#runtime-objective-title')?.textContent || '',
      feed: document.querySelector('#runtime-feed-text')?.textContent || '',
      causalityCells: document.querySelector('[data-testid="runtime-causality-strip"]')?.children.length || 0,
      resourceValues: resources,
      touchTargets,
      touchTargetsUnder48: touchTargets.filter(item => item.width < 47.5 || item.height < 47.5),
      visibleText,
      visibleTextUnderMinimum: visibleText.filter(item => item.fontSize + .01 < minimumFont),
      duplicateBattleShortcutsVisible: [...document.querySelectorAll('.runtime-event-banner, .runtime-shortcut-rail')]
        .some(element => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0),
      bridge: window.__s02Runtime,
      renderer: window.__s02BattleRenderer,
      expected: { visualVersion, responsiveStrategy, minimumFont }
    };
  }, { width: viewport.width, height: viewport.height, minimumFont, visualVersion, responsiveStrategy });
}

function validate(layout, viewport, consoleErrors, pageErrors, minimumFont = 11) {
  check(layout.overflow <= 1 && layout.bodyOverflow <= 1, `${viewport.name}: horizontal overflow.`);
  check(Math.abs(layout.nav.bottom - viewport.height) <= 2, `${viewport.name}: bottom navigation not pinned.`);
  check(layout.battle.height >= 339, `${viewport.name}: battle scene too shallow: ${layout.battle.height}.`);
  check(layout.shell.ready === 'true' && layout.shell.visual === 'true', `${viewport.name}: runtime/visual layer not ready.`);
  check(layout.shell.observer === 'true' && layout.shell.causality === 'true', `${viewport.name}: actual event/causality bridge missing.`);
  check(layout.shell.responsiveStrategy === responsiveStrategy, `${viewport.name}: shell responsive strategy mismatch.`);
  check(layout.canvas.ready === 'true' && layout.canvas.repair === visualVersion, `${viewport.name}: renderer repair not ready.`);
  check(layout.canvas.responsiveStrategy === responsiveStrategy, `${viewport.name}: renderer responsive strategy mismatch.`);
  check(layout.canvas.floor === layout.game.floor, `${viewport.name}: rendered floor differs from actual game.`);
  check(layout.canvas.cats === layout.game.cats && layout.canvas.enemies === layout.game.enemies, `${viewport.name}: rendered units differ from actual game.`);
  check(layout.party.count === 4 && layout.canvas.partySlotCount === 4 && layout.party.followsBattle && layout.party.placement === 'after-battle',
    `${viewport.name}: four-slot party placement/identity invalid: ${JSON.stringify(layout.party)}.`);
  check(layout.canvas.visualCausalityReady === 'true' && layout.objective && layout.feed && layout.causalityCells === 3,
    `${viewport.name}: visual causality contract missing.`);
  check(layout.touchTargetsUnder48.length === 0, `${viewport.name}: touch targets under 48 CSS px: ${JSON.stringify(layout.touchTargetsUnder48)}.`);
  check(layout.visibleTextUnderMinimum.length === 0,
    `${viewport.name}: visible text under ${minimumFont}px: ${JSON.stringify(layout.visibleTextUnderMinimum)}.`);
  check(layout.resourceValues.every(item => item.text && item.scrollWidth <= item.clientWidth + 1 && item.fontSize >= 11),
    `${viewport.name}: resource clipping/readability failure: ${JSON.stringify(layout.resourceValues)}.`);
  check(layout.duplicateBattleShortcutsVisible === false, `${viewport.name}: redundant battle shortcuts remain visible.`);
  check(layout.bridge?.source === 'window.__game' && layout.renderer?.source === 'window.__game', `${viewport.name}: actual game is not display authority.`);
  check(layout.bridge?.responsiveStrategy === responsiveStrategy && layout.renderer?.responsiveStrategy === responsiveStrategy,
    `${viewport.name}: exposed responsive contract mismatch.`);
  check(consoleErrors.length === 0, `${viewport.name}: console errors: ${consoleErrors.join(' | ')}`);
  check(pageErrors.length === 0, `${viewport.name}: page errors: ${pageErrors.join(' | ')}`);
}

async function createPage(browser, viewport, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, locale: 'ja-JP', reducedMotion });
  await context.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  return { context, page, consoleErrors, pageErrors };
}

async function viewportRun(browser, viewport) {
  const session = await createPage(browser, { width: viewport.width, height: viewport.height });
  await boot(session.page);
  const hydration = await summonTo(session.page, 4);
  const layout = await inspect(session.page, viewport, 11);
  validate(layout, viewport, session.consoleErrors, session.pageErrors, 11);
  const screenshot = path.join(outputDir, `s02-root-${viewport.name}.png`);
  await session.page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'normal-after-explicit-summon', viewport, hydration, layout, screenshot: path.basename(screenshot) });
  await session.context.close();
}

async function interactionRun(browser) {
  const session = await createPage(browser, { width: 390, height: 844 });
  const page = session.page;
  await boot(page);
  await summonTo(page, 4);
  const before = await page.evaluate(() => window.__game.fieldCats.length);
  await page.locator('#btn-summon').click();
  await page.waitForFunction(value => window.__game.fieldCats.length > value, before);

  await page.locator('.runtime-party-slot').first().click();
  await page.waitForSelector('.sheet.open');
  const close = page.locator('.sheet.open .close').last();
  check(await close.count() === 1, 'Interaction: agency close button missing.');
  await close.click();
  await page.waitForSelector('.sheet', { state: 'detached' });

  await page.locator('.runtime-nav-button[data-runtime-action="commerce"]').click();
  await page.waitForFunction(() => document.querySelector('#runtime-scroll')?.scrollTop > 0);
  await page.locator('.runtime-nav-button[data-runtime-action="events"]').click();
  check((await page.locator('#runtime-toast').textContent()).includes('制作中'), 'Interaction: pending event state not explicit.');
  await page.locator('.runtime-nav-button[data-runtime-action="tower"]').click();
  await page.waitForFunction(() => document.querySelector('#runtime-scroll')?.scrollTop === 0);

  const state = await page.evaluate(() => ({
    gameCats: window.__game.fieldCats.length,
    renderedCats: Number(document.querySelector('#runtime-battle-canvas').dataset.actualCatCount),
    partySlotCount: document.querySelectorAll('.runtime-party-slot').length,
    partyPlacement: document.querySelector('[data-testid="runtime-party-dock"]')?.dataset.placement,
    feed: document.querySelector('#runtime-feed-text').textContent,
    activeNav: document.querySelector('.runtime-nav-button.is-active')?.dataset.runtimeAction || '',
    strategy: document.querySelector('[data-testid="s02-runtime-shell"]')?.dataset.responsiveStrategy
  }));
  check(state.gameCats === state.renderedCats && state.partySlotCount === 4 && state.partyPlacement === 'after-battle' &&
    state.feed && state.activeNav === 'tower' && state.strategy === responsiveStrategy,
    'Interaction: state, party placement, feed, responsive strategy or tower navigation diverged.');
  check(session.consoleErrors.length === 0 && session.pageErrors.length === 0,
    `Interaction browser errors: ${session.consoleErrors.join(' | ')} ${session.pageErrors.join(' | ')}`);
  const screenshot = path.join(outputDir, 's02-root-390x844-interaction.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'actual-interaction', state, screenshot: path.basename(screenshot) });
  await session.context.close();
}

async function alternateRun(browser, mode) {
  const reduced = mode === 'reduced-motion';
  const session = await createPage(browser, { width: 390, height: 844 }, reduced ? 'reduce' : 'no-preference');
  await boot(session.page, mode === 'large-text' ? `${baseUrl}?largeText=1` : baseUrl);
  await summonTo(session.page, 4);
  const minimumFont = 11;
  const layout = await inspect(session.page, { name: mode, width: 390, height: 844 }, minimumFont);
  validate(layout, { name: mode, width: 390, height: 844 }, session.consoleErrors, session.pageErrors, minimumFont);
  const state = await session.page.evaluate(({ reduced, mode }) => {
    const keySelectors = [
      '.runtime-profile-copy strong',
      '.runtime-context-copy h1',
      '#runtime-objective-title',
      '.runtime-party-dock-heading strong',
      '.runtime-party-slot-copy strong',
      '#btn-summon .sum-label',
      '.runtime-nav-button b'
    ];
    const keyTextSizes = keySelectors
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map(element => ({
        text: element.textContent.trim().slice(0, 40),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
      }));
    return {
      largeText: document.body.classList.contains('runtime-large-text'),
      reducedMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      keyTextSizes,
      expectedReduced: reduced,
      mode
    };
  }, { reduced, mode });
  check(reduced ? state.reducedMatches : state.largeText, `${mode}: requested browser mode not active.`);
  if (mode === 'large-text') {
    check(state.keyTextSizes.length > 0 && state.keyTextSizes.every(item => item.fontSize >= 13),
      `${mode}: key text did not scale to at least 13px: ${JSON.stringify(state.keyTextSizes)}.`);
  }
  const screenshot = path.join(outputDir, `s02-root-390x844-${mode}.png`);
  await session.page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode, state, layout, screenshot: path.basename(screenshot) });
  await session.context.close();
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

const normalResults = results.filter(result => result.mode === 'normal-after-explicit-summon');
const shortBattle = normalResults.find(result => result.viewport.name === '375x667')?.layout?.battle?.height || 0;
const tallBattle = normalResults.find(result => result.viewport.name === '390x844')?.layout?.battle?.height || 0;
check(tallBattle >= shortBattle + 40,
  `Adaptive height allocation failed: 390x844 battle ${tallBattle}px, 375x667 battle ${shortBattle}px.`);

const report = {
  verdict: failures.length ? 'FAIL_S02_RESPONSIVE_VISUAL_REPAIR_BROWSER' : 'PASS_S02_RESPONSIVE_VISUAL_REPAIR_BROWSER',
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  route: '/',
  source: 'window.__game',
  eventSource: 'non-consuming window.__game.emit observation',
  visualRepairVersion: visualVersion,
  responsiveStrategy,
  referenceWidthCssPx: 390,
  minimumReadableTextCssPx: 11,
  preferredTouchTargetCssPx: 48,
  normalScreenshotState: 'normal-after-explicit-summon interactions',
  deviceMatrix: viewports.map(({ name, width, height }) => ({ name, width, height, aspect: Number((height / width).toFixed(4)) })),
  resultCount: results.length,
  adaptiveHeightEvidence: { shortViewport: '375x667', shortBattle, tallViewport: '390x844', tallBattle },
  results,
  failures,
  productionChanged: false,
  physicalIPhone: 'NOT_VERIFIED'
};
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
