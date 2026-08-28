import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE || 'playwright';
const { chromium } = require(playwrightPackage);

const baseUrl = process.env.S02_BASE_URL || 'http://127.0.0.1:4173/step4/s02/';
const outputDir = path.resolve(
  process.env.S02_EVIDENCE_DIR ||
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-browser-evidence'
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

async function waitUntilReady(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-testid="s02-shell"]')?.dataset.ready === 'true');
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

async function stabilizeVisual(page) {
  const auto = page.locator('#auto-toggle');
  if (await auto.getAttribute('aria-pressed') === 'true') await auto.click();
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-play-state: paused !important;
        caret-color: transparent !important;
      }
      .toast { display: none !important; }
    `
  });
  await page.waitForTimeout(120);
}

async function inspectLayout(page, viewport) {
  return page.evaluate(({ width, height }) => {
    const shell = document.querySelector('[data-testid="s02-shell"]');
    const header = document.querySelector('.player-bar');
    const context = document.querySelector('.context-bar');
    const nav = document.querySelector('.bottom-nav');
    const stage = document.querySelector('.battle-stage');
    const root = document.documentElement;
    const body = document.body;
    const visibleTargets = [...document.querySelectorAll('.tap-target')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2))
        };
      });
    const tooSmall = visibleTargets.filter((target) => target.width < 43.5 || target.height < 43.5);
    const shellRect = shell.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const contextRect = context.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return {
      viewport: { width, height },
      ready: shell.dataset.ready,
      document: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth
      },
      shell: {
        left: Number(shellRect.left.toFixed(2)),
        right: Number(shellRect.right.toFixed(2)),
        top: Number(shellRect.top.toFixed(2)),
        bottom: Number(shellRect.bottom.toFixed(2)),
        width: Number(shellRect.width.toFixed(2)),
        height: Number(shellRect.height.toFixed(2)),
        scrollWidth: shell.scrollWidth,
        clientWidth: shell.clientWidth
      },
      header: {
        top: Number(headerRect.top.toFixed(2)),
        bottom: Number(headerRect.bottom.toFixed(2)),
        height: Number(headerRect.height.toFixed(2))
      },
      context: {
        top: Number(contextRect.top.toFixed(2)),
        bottom: Number(contextRect.bottom.toFixed(2)),
        height: Number(contextRect.height.toFixed(2))
      },
      stage: {
        top: Number(stageRect.top.toFixed(2)),
        bottom: Number(stageRect.bottom.toFixed(2)),
        height: Number(stageRect.height.toFixed(2))
      },
      nav: {
        top: Number(navRect.top.toFixed(2)),
        bottom: Number(navRect.bottom.toFixed(2)),
        height: Number(navRect.height.toFixed(2))
      },
      targetCount: visibleTargets.length,
      tooSmall
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
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await waitUntilReady(page);
  await stabilizeVisual(page);
  const layout = await inspectLayout(page, viewport);

  assert(layout.ready === 'true', `${viewport.name}: readiness signal missing.`);
  assert(layout.document.scrollWidth <= layout.document.clientWidth + 1, `${viewport.name}: document horizontal overflow.`);
  assert(layout.document.bodyScrollWidth <= layout.document.bodyClientWidth + 1, `${viewport.name}: body horizontal overflow.`);
  assert(layout.shell.scrollWidth <= layout.shell.clientWidth + 1, `${viewport.name}: shell horizontal overflow.`);
  assert(layout.shell.left >= -0.5 && layout.shell.right <= viewport.width + 0.5, `${viewport.name}: shell escapes viewport.`);
  assert(layout.header.top >= -0.5, `${viewport.name}: player header is clipped.`);
  assert(layout.context.top >= layout.header.bottom - 1, `${viewport.name}: context strip overlaps header.`);
  assert(layout.nav.bottom <= viewport.height + 0.5 && layout.nav.bottom >= viewport.height - 2, `${viewport.name}: bottom navigation is not pinned to viewport.`);
  assert(layout.stage.height >= 290, `${viewport.name}: battle scene is too shallow.`);
  assert(layout.targetCount >= 25, `${viewport.name}: visible interaction density is unexpectedly low.`);
  assert(layout.tooSmall.length === 0, `${viewport.name}: targets below 44px: ${JSON.stringify(layout.tooSmall)}`);
  assert(consoleErrors.length === 0, `${viewport.name}: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `${viewport.name}: uncaught page errors: ${pageErrors.join(' | ')}`);

  const screenshot = path.join(outputDir, `s02-${viewport.name}-normal.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });

  results.push({ viewport, layout, consoleErrors, pageErrors, screenshot: path.basename(screenshot) });
  await context.close();
}

async function runInteractionFlow(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'dark',
    reducedMotion: 'no-preference'
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await waitUntilReady(page);

  const auto = page.locator('#auto-toggle');
  assert(await auto.getAttribute('aria-pressed') === 'true', 'Interaction: auto must start ON.');
  await auto.click();
  assert(await auto.getAttribute('aria-pressed') === 'false', 'Interaction: auto toggle did not switch OFF.');
  assert((await auto.textContent()).includes('OFF'), 'Interaction: OFF label did not render.');

  const speed = page.locator('#speed-toggle');
  assert((await speed.getAttribute('aria-label'))?.includes('1.5'), 'Interaction: speed must start at 1.5x.');
  await speed.click();
  assert((await speed.getAttribute('aria-label'))?.includes('2倍'), 'Interaction: speed did not advance to 2x.');

  const skill = page.locator('.skill-button').first();
  await skill.click();
  assert(await skill.evaluate((element) => element.classList.contains('is-cooling')), 'Interaction: skill did not enter cooldown.');
  assert((await skill.getAttribute('aria-label'))?.includes('再使用まで'), 'Interaction: skill cooldown accessible label is missing.');

  const support = page.locator('#support-button');
  await support.click();
  assert(await support.getAttribute('aria-pressed') === 'true', 'Interaction: merchant support did not activate.');
  assert((await support.textContent()).includes('発動中'), 'Interaction: merchant support active state is not visible.');

  const commerceTab = page.locator('[data-tab="commerce"]');
  await commerceTab.click();
  assert(await commerceTab.getAttribute('aria-current') === 'page', 'Interaction: commerce tab did not become current.');
  assert(await commerceTab.evaluate((element) => element.classList.contains('is-active')), 'Interaction: commerce tab active style is missing.');

  await page.locator('[data-testid="battle-scroll"]').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(120);
  const screenshot = path.join(outputDir, 's02-390x844-interaction-support.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });

  assert(consoleErrors.length === 0, `Interaction: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `Interaction: uncaught errors: ${pageErrors.join(' | ')}`);
  results.push({
    flow: 'auto-speed-skill-support-navigation',
    screenshot: path.basename(screenshot),
    consoleErrors,
    pageErrors,
    final: {
      autoPressed: await auto.getAttribute('aria-pressed'),
      speedLabel: await speed.getAttribute('aria-label'),
      skillLabel: await skill.getAttribute('aria-label'),
      supportPressed: await support.getAttribute('aria-pressed'),
      currentTab: await commerceTab.getAttribute('aria-current')
    }
  });
  await context.close();
}

async function runReducedMotion(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await waitUntilReady(page);

  const evidence = await page.evaluate(() => {
    const allyAnimation = getComputedStyle(document.querySelector('.ally img')).animationName;
    const enemyAnimation = getComputedStyle(document.querySelector('.enemy img')).animationName;
    return {
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      allyAnimation,
      enemyAnimation,
      autoPressed: document.querySelector('#auto-toggle').getAttribute('aria-pressed')
    };
  });
  assert(evidence.mediaMatches === true, 'Reduced motion: media query does not match.');
  assert(evidence.allyAnimation === 'none', `Reduced motion: ally loop remains active (${evidence.allyAnimation}).`);
  assert(evidence.enemyAnimation === 'none', `Reduced motion: enemy loop remains active (${evidence.enemyAnimation}).`);
  assert(consoleErrors.length === 0, `Reduced motion: console errors: ${consoleErrors.join(' | ')}`);
  assert(pageErrors.length === 0, `Reduced motion: uncaught errors: ${pageErrors.join(' | ')}`);

  const screenshot = path.join(outputDir, 's02-390x844-reduced-motion.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  results.push({ mode: 'reduced-motion', evidence, screenshot: path.basename(screenshot), consoleErrors, pageErrors });
  await context.close();
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) await runViewport(browser, viewport);
  await runInteractionFlow(browser);
  await runReducedMotion(browser);
} finally {
  await browser.close();
}

const report = {
  verdict: failures.length ? 'FAIL_S02_BROWSER_QA' : 'PASS_S02_BROWSER_QA',
  baseUrl,
  generatedAt: new Date().toISOString(),
  playwrightPackage,
  requiredViewports: viewports,
  results,
  failures
};
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
