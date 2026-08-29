import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE || 'playwright';
const { chromium } = require(playwrightPackage);

const origin = process.env.S02_ORIGIN || 'http://127.0.0.1:4173';
const outputDir = path.resolve(
  process.env.S02_MAIN_ENTRY_EVIDENCE_DIR ||
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence'
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

async function waitForRoot(page) {
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (
    document.documentElement.dataset.mainEntryReady === 'true' &&
    document.querySelector('[data-testid="s02-shell"]')?.dataset.ready === 'true'
  ), null, { timeout: 10000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

async function stabilize(page) {
  const auto = page.locator('#auto-toggle');
  if (await auto.getAttribute('aria-pressed') === 'true') await auto.click();
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation-play-state: paused !important; caret-color: transparent !important; }
      .toast { display: none !important; }
    `
  });
  await page.waitForTimeout(120);
}

async function inspectRoot(page, viewport) {
  return page.evaluate(({ width, height }) => {
    const shell = document.querySelector('[data-testid="s02-shell"]');
    const nav = document.querySelector('.bottom-nav');
    const stage = document.querySelector('.battle-stage');
    const header = document.querySelector('.player-bar');
    const root = document.documentElement;
    const body = document.body;
    const shellRect = shell.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const embeds = document.querySelectorAll('iframe, object, embed').length;
    const stylesheetHrefs = [...document.styleSheets].map((sheet) => sheet.href).filter(Boolean);
    return {
      viewport: { width, height },
      mainEntryReady: root.dataset.mainEntryReady,
      shellReady: shell.dataset.ready,
      runtimeEntry: shell.dataset.runtimeEntry,
      sourceRoute: shell.dataset.sourceRoute,
      embeds,
      documentWidth: { client: root.clientWidth, scroll: root.scrollWidth },
      bodyWidth: { client: body.clientWidth, scroll: body.scrollWidth },
      shell: {
        left: Number(shellRect.left.toFixed(2)),
        right: Number(shellRect.right.toFixed(2)),
        width: Number(shellRect.width.toFixed(2)),
        clientWidth: shell.clientWidth,
        scrollWidth: shell.scrollWidth
      },
      header: { top: Number(headerRect.top.toFixed(2)), height: Number(headerRect.height.toFixed(2)) },
      nav: { top: Number(navRect.top.toFixed(2)), bottom: Number(navRect.bottom.toFixed(2)), height: Number(navRect.height.toFixed(2)) },
      stage: { height: Number(stageRect.height.toFixed(2)), backgroundImage: getComputedStyle(stage).backgroundImage },
      stylesheetHrefs
    };
  }, viewport);
}

async function runRootViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'dark',
    reducedMotion: 'no-preference'
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const badResponses = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) badResponses.push(`${response.status()} ${response.url()}`);
  });

  await waitForRoot(page);
  await stabilize(page);
  const layout = await inspectRoot(page, viewport);

  assert(layout.mainEntryReady === 'true', `${viewport.name}: root readiness signal missing.`);
  assert(layout.shellReady === 'true', `${viewport.name}: S02 application readiness signal missing.`);
  assert(layout.runtimeEntry === 'main', `${viewport.name}: S02 shell is not mounted as the main entry.`);
  assert(layout.sourceRoute === '/step4/s02/index.html', `${viewport.name}: unexpected S02 source route.`);
  assert(layout.embeds === 0, `${viewport.name}: embedded-document integration detected.`);
  assert(layout.documentWidth.scroll <= layout.documentWidth.client + 1, `${viewport.name}: document horizontal overflow.`);
  assert(layout.bodyWidth.scroll <= layout.bodyWidth.client + 1, `${viewport.name}: body horizontal overflow.`);
  assert(layout.shell.scrollWidth <= layout.shell.clientWidth + 1, `${viewport.name}: shell horizontal overflow.`);
  assert(layout.shell.left >= -0.5 && layout.shell.right <= viewport.width + 0.5, `${viewport.name}: shell escapes viewport.`);
  assert(layout.header.top >= -0.5, `${viewport.name}: header is clipped.`);
  assert(layout.nav.bottom <= viewport.height + 0.5 && layout.nav.bottom >= viewport.height - 2, `${viewport.name}: bottom navigation is not pinned.`);
  assert(layout.stage.height >= 290, `${viewport.name}: battle scene is too shallow.`);
  assert(layout.stage.backgroundImage.includes('s02-forest-approved.webp') || layout.stage.backgroundImage.includes('floor_living.png'), `${viewport.name}: approved active background layer is absent.`);
  assert(layout.stylesheetHrefs.some((href) => href.endsWith('/step4/s02/production.css')), `${viewport.name}: production visual stylesheet is not loaded.`);
  assert(consoleErrors.length === 0, `${viewport.name}: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `${viewport.name}: page errors: ${pageErrors.join(' | ')}`);
  assert(requestFailures.length === 0, `${viewport.name}: request failures: ${requestFailures.join(' | ')}`);
  assert(badResponses.length === 0, `${viewport.name}: HTTP failures: ${badResponses.join(' | ')}`);

  const screenshot = path.join(outputDir, `root-${viewport.name}-normal.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ type: 'root-viewport', viewport, layout, consoleErrors, pageErrors, requestFailures, badResponses, screenshot: path.basename(screenshot) });
  await context.close();
}

async function runRootInteraction(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await waitForRoot(page);

  const auto = page.locator('#auto-toggle');
  assert(await auto.getAttribute('aria-pressed') === 'true', 'Root interaction: auto must start ON.');
  await auto.click();
  assert(await auto.getAttribute('aria-pressed') === 'false', 'Root interaction: auto did not switch OFF.');

  const speed = page.locator('#speed-toggle');
  assert((await speed.getAttribute('aria-label'))?.includes('1.5'), 'Root interaction: speed must start at 1.5x.');
  await speed.click();
  assert((await speed.getAttribute('aria-label'))?.includes('2倍'), 'Root interaction: speed did not advance to 2x.');

  const skill = page.locator('.skill-button').first();
  await skill.click();
  assert(await skill.evaluate((element) => element.classList.contains('is-cooling')), 'Root interaction: skill did not enter cooldown.');

  const support = page.locator('#support-button');
  await support.click();
  assert(await support.getAttribute('aria-pressed') === 'true', 'Root interaction: merchant support did not activate.');

  const commerce = page.locator('[data-tab="commerce"]');
  await commerce.click();
  assert(await commerce.getAttribute('aria-current') === 'page', 'Root interaction: commerce tab did not become current.');

  await page.locator('[data-testid="battle-scroll"]').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(120);
  const screenshot = path.join(outputDir, 'root-390x844-interaction.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });

  assert(consoleErrors.length === 0, `Root interaction console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `Root interaction page errors: ${pageErrors.join(' | ')}`);
  results.push({ type: 'root-interaction', screenshot: path.basename(screenshot), consoleErrors, pageErrors });
  await context.close();
}

async function runLargeText(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const page = await context.newPage();
  await waitForRoot(page);
  await page.addStyleTag({
    content: `
      .profile-copy strong, .resource-card strong, .context-copy h1, .context-copy p,
      .shortcut b, .skill-button b, .roster-card strong, .action-button strong,
      .support-card strong, .support-card p, .support-summary, .support-button,
      .nav-button strong { font-size: 120% !important; }
    `
  });
  await page.waitForTimeout(120);
  const evidence = await page.evaluate(() => {
    const root = document.documentElement;
    const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
    const auto = document.querySelector('#auto-toggle').getBoundingClientRect();
    const support = document.querySelector('#support-button').getBoundingClientRect();
    return {
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
      navVisible: nav.bottom <= innerHeight + 1 && nav.bottom >= innerHeight - 2,
      autoVisible: auto.width > 0 && auto.height >= 44,
      supportPresent: support.width > 0 && support.height >= 44
    };
  });
  assert(!evidence.horizontalOverflow, 'Large-text simulation: horizontal overflow.');
  assert(evidence.navVisible, 'Large-text simulation: bottom navigation is not reachable.');
  assert(evidence.autoVisible, 'Large-text simulation: auto control is not usable.');
  assert(evidence.supportPresent, 'Large-text simulation: support control is not usable.');
  const screenshot = path.join(outputDir, 'root-390x844-large-text.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ type: 'browser-large-text-simulation', evidence, screenshot: path.basename(screenshot) });
  await context.close();
}

async function runReducedMotion(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  await waitForRoot(page);
  const evidence = await page.evaluate(() => ({
    mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    allyAnimation: getComputedStyle(document.querySelector('.ally img')).animationName,
    enemyAnimation: getComputedStyle(document.querySelector('.enemy img')).animationName,
    spinnerPresent: Boolean(document.querySelector('.main-entry-spinner'))
  }));
  assert(evidence.mediaMatches, 'Reduced motion: media query does not match.');
  assert(evidence.allyAnimation === 'none', `Reduced motion: ally animation remains (${evidence.allyAnimation}).`);
  assert(evidence.enemyAnimation === 'none', `Reduced motion: enemy animation remains (${evidence.enemyAnimation}).`);
  assert(!evidence.spinnerPresent, 'Reduced motion: loading spinner remained after mount.');
  const screenshot = path.join(outputDir, 'root-390x844-reduced-motion.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ type: 'root-reduced-motion', evidence, screenshot: path.basename(screenshot) });
  await context.close();
}

async function runSourceAndLegacy(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const page = await context.newPage();
  await page.goto(`${origin}/step4/s02/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-testid="s02-shell"]')?.dataset.ready === 'true');
  const source = await page.evaluate(() => ({
    productionCssLoaded: [...document.styleSheets].some((sheet) => sheet.href?.endsWith('/step4/s02/production.css')),
    runtimeEntry: document.querySelector('[data-testid="s02-shell"]').dataset.runtimeEntry || null
  }));
  assert(source.productionCssLoaded, 'Isolated S02 source does not load production.css.');
  const sourceScreenshot = path.join(outputDir, 'source-390x844-normal.png');
  await page.screenshot({ path: sourceScreenshot, animations: 'disabled' });

  await page.goto(`${origin}/legacy.html`, { waitUntil: 'networkidle' });
  const legacy = await page.evaluate(() => ({
    canvas: Boolean(document.querySelector('#battle')),
    towerList: Boolean(document.querySelector('#tower-list')),
    oldApp: Boolean(document.querySelector('#app'))
  }));
  assert(legacy.canvas && legacy.towerList && legacy.oldApp, 'Legacy runtime entry was not preserved.');
  results.push({ type: 'source-and-legacy', source, legacy, sourceScreenshot: path.basename(sourceScreenshot) });
  await context.close();
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) await runRootViewport(browser, viewport);
  await runRootInteraction(browser);
  await runLargeText(browser);
  await runReducedMotion(browser);
  await runSourceAndLegacy(browser);
} finally {
  await browser.close();
}

const report = {
  verdict: failures.length ? 'FAIL_S02_MAIN_ENTRY_BROWSER_QA' : 'PASS_S02_MAIN_ENTRY_BROWSER_QA',
  origin,
  generatedAt: new Date().toISOString(),
  playwrightPackage,
  rootEntry: '/',
  sourceEntry: '/step4/s02/',
  legacyEntry: '/legacy.html',
  largeTextEvidence: 'BROWSER_SIMULATION_NOT_PHYSICAL_IOS',
  physicalIPhoneVerified: false,
  results,
  failures
};
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
