import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE || 'playwright';
const { chromium } = require(playwrightPackage);

const baseUrl = process.env.S02_GM_BASE_URL || 'http://127.0.0.1:4173/step4/s02/golden-master-p1/';
const outputDir = path.resolve(
  process.env.S02_GM_EVIDENCE_DIR ||
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-browser-evidence'
);

const scenarios = [
  { id: 'GM01', width: 390, height: 844, minBattle: 352, state: 'normal' },
  { id: 'GM02', width: 320, height: 667, minBattle: 300, state: 'normal' },
  { id: 'GM03', width: 375, height: 667, minBattle: 300, state: 'normal' },
  { id: 'GM04', width: 320, height: 568, minBattle: 300, state: 'normal' },
  { id: 'GM05', width: 430, height: 932, minBattle: 404, state: 'normal' },
  { id: 'GM06', width: 390, height: 844, minBattle: 352, state: 'reward' },
  { id: 'GM07', width: 390, height: 844, minBattle: 352, state: 'offline' },
  { id: 'GM08', width: 390, height: 844, minBattle: 352, state: 'roster' },
  { id: 'RV360', gm: 'GM01', viewport: '360x800', width: 360, height: 800, minBattle: 352, state: 'normal' },
  { id: 'RV412', gm: 'GM01', viewport: '412x915', width: 412, height: 915, minBattle: 404, state: 'normal' }
];

const failures = [];
const results = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function scenarioUrl(scenario) {
  const query = new URLSearchParams({ gm: scenario.gm || scenario.id, capture: '1' });
  if (scenario.viewport) query.set('viewport', scenario.viewport);
  return `${baseUrl}?${query.toString()}`;
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

for (const scenario of scenarios) {
  const context = await browser.newContext({
    viewport: { width: scenario.width, height: scenario.height },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || 'failed'}`));

  await page.goto(scenarioUrl(scenario), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.reviewReady === 'true');
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const required = [
      './assets/tower-corridor.webp',
      './assets/party-roster.webp',
      './assets/party-actions.webp',
      './assets/clockwork-marten.webp'
    ];
    await Promise.all(required.map((source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Image decode failed: ${source}`));
      image.src = source;
    })));
  });
  await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important}' });

  const layout = await page.evaluate(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        left: Number(value.left.toFixed(2)),
        top: Number(value.top.toFixed(2)),
        right: Number(value.right.toFixed(2)),
        bottom: Number(value.bottom.toFixed(2)),
        width: Number(value.width.toFixed(2)),
        height: Number(value.height.toFixed(2))
      };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
    };
    const stage = document.querySelector('[data-testid="gm-stage"]');
    const battle = document.querySelector('[data-testid="battlefield"]');
    const nav = document.querySelector('[data-testid="bottom-nav"]');
    const enemy = document.querySelector('[data-enemy]');
    const cats = [...document.querySelectorAll('[data-cat-id]')];
    const textUnderMinimum = [...stage.querySelectorAll('*')]
      .filter((element) => element.children.length === 0 && element.textContent.trim() && visible(element))
      .map((element) => ({
        text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 48),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        className: typeof element.className === 'string' ? element.className : ''
      }))
      .filter((item) => item.fontSize < 10.99);
    const targetSelectors = '.primary-action,.support-detail,.nav-item,.modal-disabled';
    const targets = [...stage.querySelectorAll(targetSelectors)]
      .filter(visible)
      .map((element) => ({ label: element.textContent.trim().replace(/\s+/g, ' '), ...rect(element) }));
    const criticalSelectors = '.floor-marker strong,.battle-objective strong,.auto-chip,.enemy-hp,.party-state,.party-copy strong,.support-copy strong';
    const clippedCritical = [...stage.querySelectorAll(criticalSelectors)]
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map((element) => ({
        text: element.textContent.trim().replace(/\s+/g, ' '),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      }));
    const loadedImages = [...document.images].map((image) => ({
      source: image.getAttribute('src'),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight
    }));
    const origin = location.origin;
    const externalResources = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => !url.startsWith(origin));
    return {
      ready: document.body.dataset.reviewReady,
      stage: rect(stage),
      battle: rect(battle),
      nav: rect(nav),
      enemy: rect(enemy),
      cats: cats.map(rect),
      catIds: cats.map((cat) => cat.dataset.catId),
      stageScroll: { width: stage.scrollWidth, clientWidth: stage.clientWidth, height: stage.scrollHeight, clientHeight: stage.clientHeight },
      documentScroll: {
        width: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight
      },
      textUnderMinimum,
      targets,
      clippedCritical,
      loadedImages,
      externalResources,
      bodyText: stage.innerText.replace(/\s+/g, ' ').trim(),
      actionImage: getComputedStyle(stage.querySelector('.cat-art')).backgroundImage,
      backgroundImage: getComputedStyle(stage.querySelector('.tower-scene')).backgroundImage
    };
  });

  const prefix = scenario.id;
  check(layout.ready === 'true', `${prefix}: readiness signal missing.`);
  check(Math.abs(layout.stage.width - scenario.width) <= 0.5 && Math.abs(layout.stage.height - scenario.height) <= 0.5, `${prefix}: stage does not equal its exact viewport.`);
  check(layout.stage.left >= -0.5 && layout.stage.top >= -0.5 && layout.stage.right <= scenario.width + 0.5 && layout.stage.bottom <= scenario.height + 0.5, `${prefix}: stage escapes viewport.`);
  check(layout.stageScroll.width <= layout.stageScroll.clientWidth + 1 && layout.stageScroll.height <= layout.stageScroll.clientHeight + 1, `${prefix}: fixed screen clips overflowing content.`);
  check(layout.documentScroll.width <= layout.documentScroll.clientWidth + 1 && layout.documentScroll.height <= layout.documentScroll.clientHeight + 1, `${prefix}: capture document scrolls.`);
  check(layout.battle.height >= scenario.minBattle - 0.5, `${prefix}: battlefield ${layout.battle.height}px below ${scenario.minBattle}px minimum.`);
  check(layout.battle.top >= -0.5 && layout.battle.bottom <= scenario.height + 0.5, `${prefix}: battlefield is outside first viewport.`);
  check(layout.nav.bottom >= scenario.height - 1 && layout.nav.bottom <= scenario.height + 0.5, `${prefix}: bottom navigation is not pinned.`);
  check(layout.enemy.height >= 68 && layout.enemy.top < layout.battle.bottom && layout.enemy.bottom > layout.battle.top, `${prefix}: normal enemy is not recognisable in battle.`);
  check(layout.cats.every((cat) => cat.height >= 54 && cat.top < layout.battle.bottom && cat.bottom > layout.battle.top), `${prefix}: one or more cats are too small or outside battle.`);
  check(layout.textUnderMinimum.length === 0, `${prefix}: visible text below 11px: ${JSON.stringify(layout.textUnderMinimum)}`);
  check(layout.targets.every((target) => target.width >= 44 && target.height >= 44), `${prefix}: visual control below 44px: ${JSON.stringify(layout.targets.filter((target) => target.width < 44 || target.height < 44))}`);
  check(layout.clippedCritical.length === 0, `${prefix}: critical text clips: ${JSON.stringify(layout.clippedCritical)}`);
  check(layout.loadedImages.every((image) => image.complete && image.naturalWidth > 0), `${prefix}: an img asset failed decode.`);
  check(layout.backgroundImage.includes('tower-corridor.webp'), `${prefix}: battlefield background not applied.`);
  check(layout.externalResources.length === 0, `${prefix}: external resource requested: ${layout.externalResources.join(', ')}`);
  check(consoleErrors.length === 0, `${prefix}: console errors: ${consoleErrors.join(' | ')}`);
  check(pageErrors.length === 0, `${prefix}: page errors: ${pageErrors.join(' | ')}`);
  check(failedRequests.length === 0, `${prefix}: failed requests: ${failedRequests.join(' | ')}`);

  if (scenario.state === 'normal') check(layout.catIds.length === 4, `${prefix}: normal battle does not show four named cats.`);
  if (scenario.state === 'reward') {
    check(layout.catIds.length === 4, `${prefix}: reward causality loses the four-cat party.`);
    check(layout.actionImage.includes('party-actions.webp'), `${prefix}: combat action key pose is not used.`);
    for (const phrase of ['コハクの一撃', '命中', '撃破', '+9 G']) check(layout.bodyText.includes(phrase), `${prefix}: reward causality missing ${phrase}.`);
  }
  if (scenario.state === 'offline') {
    for (const phrase of ['放置進行を照合中', '照合中', '算定中', '保存前', '受取操作なし']) check(layout.bodyText.includes(phrase), `${prefix}: honest reconciliation missing ${phrase}.`);
  }
  if (scenario.state === 'roster') {
    check(layout.catIds.length === 1, `${prefix}: roster state must honestly show only the on-field cat.`);
    for (const phrase of ['出撃中', '所有済み', '加入可能', '未解放']) check(layout.bodyText.includes(phrase), `${prefix}: party state missing ${phrase}.`);
  }

  const screenshotName = `${scenario.id}-${scenario.width}x${scenario.height}.png`;
  await page.screenshot({ path: path.join(outputDir, screenshotName), animations: 'disabled' });
  results.push({ scenario, url: scenarioUrl(scenario), screenshot: screenshotName, layout, consoleErrors, pageErrors, failedRequests });
  await context.close();
}

await browser.close();

const report = {
  schemaVersion: 1,
  artifactId: 's02-golden-master-p1-browser-evidence-round-001',
  generatedAt: new Date().toISOString(),
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  head: process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']),
  tree: git(['rev-parse', 'HEAD^{tree}']),
  baseUrl,
  scenarioCount: results.length,
  minimumTextCssPx: 11,
  minimumTargetCssPx: 44,
  preferredTargetCssPx: 48,
  physicalIPhone: 'NOT_VERIFIED',
  productionChanged: false,
  verdict: failures.length === 0 ? 'PASS_S02_GOLDEN_MASTER_P1_BROWSER' : 'FAIL_S02_GOLDEN_MASTER_P1_BROWSER',
  failures,
  results
};

await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ verdict: report.verdict, failures, scenarioCount: results.length, outputDir }, null, 2));
if (failures.length) process.exit(1);
