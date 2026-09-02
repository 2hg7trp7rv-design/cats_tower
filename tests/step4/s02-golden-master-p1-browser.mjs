#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const evidenceDirectory = path.join(root, 'semantic-evidence');
const screenshotDirectory = path.join(evidenceDirectory, 'screenshots');
const rawPath = path.join(evidenceDirectory, 'browser-raw.json');
const revisionDirectory = path.join(evidenceDirectory, 'revision');
const baselineScreenshotDirectory = path.join(revisionDirectory, 'before');
const baselineRawPath = path.join(revisionDirectory, 'browser-before-raw.json');
const packagePath = path.join(root, 'step4/s02/golden-master-p1/browser-qa/package.json');
const requireFromLock = createRequire(packagePath);
const playwrightPackage = requireFromLock('playwright/package.json');
if (playwrightPackage.version !== '1.62.0') throw new Error('The installed Playwright version is not the reviewed 1.62.0 lock.');
const { chromium } = requireFromLock('playwright');
const routeAssetManifest = JSON.parse(await fs.readFile(path.join(root, 'step4/s02/golden-master-p1/asset-manifest.json'), 'utf8'));
const routeReviewManifest = JSON.parse(await fs.readFile(path.join(root, 'step4/s02/golden-master-p1/review-manifest.json'), 'utf8'));
const referenceAssetPaths = (routeAssetManifest.assets ?? []).filter((asset) => asset.kind === 'reference' && asset.reviewOnly === true).map((asset) => asset.path).sort();

const repository = '2hg7trp7rv-design/cats_tower';
const branch = 'kimi';
const baseUrl = 'http://127.0.0.1:4173/step4/s02/golden-master-p1/';
const baselineBaseUrl = 'http://127.0.0.1:4174/step4/s02/golden-master-p1/';
const expectedPath = '/step4/s02/golden-master-p1/';
const allowedResourcePaths = [...new Set([expectedPath, expectedPath + 'review-manifest.json', ...(routeReviewManifest.routeFiles ?? []).map((entry) => '/' + entry.path)])].sort();
const screenshotStabilizationCss = '*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important;transition:none!important}';
const screenshotStabilizationSha256 = 'sha256:' + createHash('sha256').update(screenshotStabilizationCss, 'utf8').digest('hex');
const scenarios = [
  { id: 'GM01', gm: 'GM01', state: 'normal', label: '390x844', width: 390, height: 844 },
  { id: 'GM02', gm: 'GM02', state: 'normal', label: '320x667', width: 320, height: 667 },
  { id: 'GM03', gm: 'GM03', state: 'normal', label: '375x667', width: 375, height: 667 },
  { id: 'GM04', gm: 'GM04', state: 'normal', label: '320x568', width: 320, height: 568 },
  { id: 'GM05', gm: 'GM05', state: 'normal', label: '430x932', width: 430, height: 932 },
  { id: 'GM06', gm: 'GM06', state: 'reward', label: '390x844', width: 390, height: 844 },
  { id: 'GM07', gm: 'GM07', state: 'offline', label: '390x844', width: 390, height: 844 },
  { id: 'GM08', gm: 'GM08', state: 'roster', label: '390x844', width: 390, height: 844 },
  { id: 'RV360', gm: 'GM01', state: 'normal', label: '360x800', width: 360, height: 800, responsive: '360x800' },
  { id: 'RV412', gm: 'GM01', state: 'normal', label: '412x915', width: 412, height: 915, responsive: '412x915' },
  { id: 'SAFE390', gm: 'GM01', state: 'normal', label: '390x844-safe-area', width: 390, height: 844, safeArea: { top: 24, right: 0, bottom: 34, left: 0 } },
  { id: 'TEXT200', gm: 'GM04', state: 'normal', label: '320x568-text-200', width: 320, height: 568, textScalePercent: 200 },
  { id: 'GM07C320', gm: 'GM07', state: 'offline', label: '320x568-offline-compact', width: 320, height: 568, responsive: '320x568' },
  { id: 'GM07C320TEXT200', gm: 'GM07', state: 'offline', label: '320x568-offline-compact-text-200-safe-area', width: 320, height: 568, responsive: '320x568', textScalePercent: 200, safeArea: { top: 24, right: 0, bottom: 34, left: 0 } },
  { id: 'TEXT200SAFE', gm: 'GM04', state: 'normal', label: '320x568-text-200-safe-area', width: 320, height: 568, textScalePercent: 200, safeArea: { top: 24, right: 0, bottom: 34, left: 0 } }
];
const offlineViewStates = ['NO_PROGRESS', 'ELAPSED_UNKNOWN', 'RECONCILING_INDETERMINATE', 'RECONCILING_DETERMINATE', 'PROVISIONAL', 'CONFIRMING', 'CONFIRMED', 'REJECTED', 'RETRYABLE_ERROR', 'UNKNOWN'];
const revisionControlPath = path.join(root, 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-036.json');
const revisionStages = [
  { lockRound: '007', evidenceRound: '002', lockArtifactId: 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-007', priorCriticRound: '001' },
  { lockRound: '009', evidenceRound: '003', lockArtifactId: 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-009', priorCriticRound: '002' },
  { lockRound: '011', evidenceRound: '004', lockArtifactId: 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-011', priorCriticRound: '003' }
].map((stage) => ({
  ...stage,
  lockPath: path.join(root, `quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-${stage.lockRound}.json`),
  priorCriticPath: path.join(root, `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-independent-critic-round-${stage.priorCriticRound}.json`)
}));
const revisionStagePresence = await Promise.all(revisionStages.map((stage) => fs.stat(stage.lockPath).then((entry) => entry.isFile()).catch(() => false)));
const activeRevisionIndex = revisionStagePresence.lastIndexOf(true);
if (activeRevisionIndex >= 0 && revisionStagePresence.slice(0, activeRevisionIndex + 1).some((present) => !present)) throw new Error('S02 revision decision-lock lineage is non-contiguous.');
const revisionMode = activeRevisionIndex >= 0;
if (revisionMode && !await fs.stat(revisionControlPath).then((entry) => entry.isFile()).catch(() => false)) throw new Error('S02 revision lock exists without the active revision change-control addendum.');
const activeRevisionStage = revisionMode ? revisionStages[activeRevisionIndex] : null;
let baselineTarget = null;
let affectedGoldenMasters = [];
let revisionAssertionDefinitions = [];
let revisionAssetDefinitions = [];
let currentRevisionLock = null;
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(label + ': exact key set mismatch.');
}
function finiteNumber(value, minimum, maximum) { return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum; }
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
function canonicalSha256(value) { return 'sha256:' + createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex'); }
function safelyScopedSelector(selector) {
  if (typeof selector !== 'string' || selector.length > 240 || selector !== selector.trim() || !selector.startsWith(':scope') || /[,~+]|:has\s*\(|[\r\n]/.test(selector)) return false;
  const atom = String.raw`(?:\*|[a-zA-Z][a-zA-Z0-9_-]*|[.#][a-zA-Z_][a-zA-Z0-9_-]*|\[(?:data-[a-z0-9-]+|aria-[a-z0-9-]+|role|id|class)(?:=(?:"[a-zA-Z0-9_.:/-]{1,120}"|'[a-zA-Z0-9_.:/-]{1,120}'|[a-zA-Z_][a-zA-Z0-9_-]*))?\])`;
  const compound = `(?:${atom})+`;
  return new RegExp(`^:scope(?:\\s+|\\s*>\\s*)${compound}(?:(?:\\s+|\\s*>\\s*)${compound})*$`).test(selector);
}
for (const selector of [':scope .item', ':scope > [data-gm="GM01"] .label', ":scope article.party-card[data-party-state='field']"]) if (!safelyScopedSelector(selector)) throw new Error('Trusted scoped-selector grammar rejected a valid safety vector.');
for (const selector of [':scope [', ':scope >> .a', ':scope > > .a', ':scope [id=foo.bar]', ':scope [id="foo\\"]', 'body .a', ':scope .a,.b', ':scope:has(.a)']) if (safelyScopedSelector(selector)) throw new Error('Trusted scoped-selector grammar accepted an invalid safety vector.');
function validateRevisionAssertions(requestedChanges) {
  const requestIds = new Set();
  const assertionIds = new Set();
  const definitions = [];
  for (const request of requestedChanges) {
    if (typeof request.id !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(request.id) || requestIds.has(request.id)) throw new Error('Revision request id is invalid or duplicated.');
    requestIds.add(request.id);
    if (!Array.isArray(request.affectedGoldenMasters) || request.affectedGoldenMasters.length < 1 || JSON.stringify(request.affectedGoldenMasters) !== JSON.stringify([...new Set(request.affectedGoldenMasters)].sort()) || !request.affectedGoldenMasters.every((id) => /^GM0[1-8]$/.test(id))) throw new Error(request.id + ': affectedGoldenMasters must be a sorted unique nonempty GM01-GM08 array.');
    if (!Array.isArray(request.targetPaths) || request.targetPaths.length < 1 || JSON.stringify(request.targetPaths) !== JSON.stringify([...new Set(request.targetPaths)].sort()) || !request.targetPaths.every((target) => typeof target === 'string' && target.length <= 240 && !target.startsWith('/') && !target.includes('..') && /^[a-zA-Z0-9._/-]+$/.test(target))) throw new Error(request.id + ': targetPaths must be a sorted unique safe repository-relative array.');
    if (!Array.isArray(request.supersedesAssertions) || JSON.stringify(request.supersedesAssertions) !== JSON.stringify([...new Set(request.supersedesAssertions)].sort()) || !request.supersedesAssertions.every((id) => /^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(id))) throw new Error(request.id + ': supersedesAssertions must be a sorted unique assertion-ID array.');
    if (!Array.isArray(request.requiredAssets) || JSON.stringify(request.requiredAssets) !== JSON.stringify([...new Set(request.requiredAssets)].sort()) || !request.requiredAssets.every((assetPath) => typeof assetPath === 'string' && /^assets\/[a-z0-9][a-z0-9._/-]*\.(?:webp|png|svg)$/i.test(assetPath) && !assetPath.includes('..'))) throw new Error(request.id + ': requiredAssets must be a sorted unique safe route-relative array.');
    const targetAssetPrefix = 'step4/s02/golden-master-p1/';
    const targetAssets = request.targetPaths.filter((target) => target.startsWith(targetAssetPrefix + 'assets/')).map((target) => target.slice(targetAssetPrefix.length)).sort();
    if (JSON.stringify(request.requiredAssets) !== JSON.stringify(targetAssets)) throw new Error(request.id + ': requiredAssets must exactly equal the route-asset targetPaths; [] is allowed only when no route asset is targeted.');
    if (!Array.isArray(request.acceptanceAssertions) || request.acceptanceAssertions.length < 1 || request.acceptanceAssertions.length > 20) throw new Error(request.id + ': acceptanceAssertions must contain 1-20 entries.');
    const coveredGoldenMasters = new Set();
    for (const assertion of request.acceptanceAssertions) {
      const common = ['id', 'type', 'goldenMaster'];
      if (typeof assertion.id !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(assertion.id) || assertionIds.has(assertion.id)) throw new Error(request.id + ': assertion id is invalid or duplicated.');
      assertionIds.add(assertion.id);
      if (!/^GM0[1-8]$/.test(assertion.goldenMaster) || !request.affectedGoldenMasters.includes(assertion.goldenMaster)) throw new Error(assertion.id + ': assertion Golden Master is outside the request scope.');
      coveredGoldenMasters.add(assertion.goldenMaster);
      if (assertion.type === 'DOM_RECT_DELTA') {
        exactKeys(assertion, [...common, 'selector', 'property', 'operator', 'threshold'], assertion.id);
        if (!['width', 'height', 'x', 'y'].includes(assertion.property) || !['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(assertion.operator) || !finiteNumber(assertion.threshold, assertion.operator === 'ABS_DELTA_GTE' ? 0 : -10000, 10000)) throw new Error(assertion.id + ': invalid DOM_RECT_DELTA contract.');
      } else if (assertion.type === 'DOM_STYLE_DELTA') {
        exactKeys(assertion, [...common, 'selector', 'property', 'operator', 'threshold'], assertion.id);
        const numeric = ['font-size', 'opacity'].includes(assertion.property) && ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(assertion.operator) && finiteNumber(assertion.threshold, assertion.operator === 'ABS_DELTA_GTE' ? 0 : -10000, 10000);
        const string = ['color', 'background-color'].includes(assertion.property) && ((assertion.operator === 'CHANGED' && assertion.threshold === null) || (assertion.operator === 'AFTER_EQUALS' && typeof assertion.threshold === 'string' && assertion.threshold.length <= 120));
        if (!numeric && !string) throw new Error(assertion.id + ': invalid DOM_STYLE_DELTA contract.');
      } else if (assertion.type === 'ROI_PIXEL_DELTA') {
        exactKeys(assertion, [...common, 'region', 'changedPixelRatio', 'meanAbsoluteChannelDelta'], assertion.id);
        exactKeys(assertion.region, ['x', 'y', 'width', 'height'], assertion.id + '.region');
        const region = assertion.region;
        if (![region.x, region.y, region.width, region.height].every((value) => finiteNumber(value, 0, 1)) || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) throw new Error(assertion.id + ': invalid normalized ROI.');
        for (const key of ['changedPixelRatio', 'meanAbsoluteChannelDelta']) if (!Array.isArray(assertion[key]) || assertion[key].length !== 2 || !assertion[key].every((value) => finiteNumber(value, 0, key === 'changedPixelRatio' ? 1 : 255)) || assertion[key][0] > assertion[key][1]) throw new Error(assertion.id + ': invalid ROI thresholds.');
      } else if (assertion.type === 'TEXT_EXACT') {
        exactKeys(assertion, [...common, 'selector', 'expected'], assertion.id);
        if (typeof assertion.expected !== 'string' || assertion.expected.length < 1 || assertion.expected.length > 240 || assertion.expected !== assertion.expected.replace(/\s+/gu, ' ').trim()) throw new Error(assertion.id + ': expected text is not canonical whitespace.');
      } else if (assertion.type === 'ELEMENT_VISIBLE') {
        exactKeys(assertion, [...common, 'selector', 'minimumArea'], assertion.id);
        if (!finiteNumber(assertion.minimumArea, 1, 1000000)) throw new Error(assertion.id + ': invalid minimum visible area.');
      } else throw new Error(assertion.id + ': unsupported revision assertion type.');
      if (assertion.type !== 'ROI_PIXEL_DELTA' && !safelyScopedSelector(assertion.selector)) throw new Error(assertion.id + ': selector is not safely scoped under the exact GM root.');
      definitions.push({ requestId: request.id, criterionSha256: canonicalSha256(assertion), originAffectedGoldenMasters: [...request.affectedGoldenMasters], originTargetPaths: [...request.targetPaths], assertion, ...assertion });
    }
    if (JSON.stringify([...coveredGoldenMasters].sort()) !== JSON.stringify(request.affectedGoldenMasters)) throw new Error(request.id + ': acceptance assertions do not cover every affected Golden Master.');
  }
  return definitions;
}
if (revisionMode) {
  const gmSet = new Set(scenarios.slice(0, 8).map((scenario) => scenario.id));
  let activeDefinitions = [];
  const lineageRequestIds = new Set();
  for (let stageIndex = 0; stageIndex <= activeRevisionIndex; stageIndex += 1) {
    const stage = revisionStages[stageIndex];
    const lock = JSON.parse(await fs.readFile(stage.lockPath, 'utf8'));
    if (lock.artifactId !== stage.lockArtifactId || !Array.isArray(lock.requestedChanges)) throw new Error(`Revision mode lacks the exact immutable round ${stage.lockRound} decision shape.`);
    const stageDefinitions = validateRevisionAssertions(lock.requestedChanges);
    for (const request of lock.requestedChanges) {
      if (lineageRequestIds.has(request.id)) throw new Error(request.id + ': request ID is duplicated across the immutable revision lineage.');
      lineageRequestIds.add(request.id);
    }
    const supersededAcrossStage = new Set();
    for (const request of lock.requestedChanges) {
      for (const assertionId of request.supersedesAssertions) {
        if (supersededAcrossStage.has(assertionId)) throw new Error(assertionId + ': a lineage criterion may be superseded exactly once per lock.');
        supersededAcrossStage.add(assertionId);
        const prior = activeDefinitions.find((definition) => definition.id === assertionId);
        if (!prior) throw new Error(assertionId + ': superseded criterion is not active in the prior lineage.');
        if (!prior.originAffectedGoldenMasters.some((gm) => request.affectedGoldenMasters.includes(gm)) || !prior.originTargetPaths.some((target) => request.targetPaths.includes(target))) throw new Error(assertionId + ': supersession is outside the originating GM/target-path scope.');
      }
    }
    activeDefinitions = activeDefinitions.filter((definition) => !supersededAcrossStage.has(definition.id));
    for (const definition of stageDefinitions) if (activeDefinitions.some((active) => active.id === definition.id)) throw new Error(definition.id + ': active lineage assertion ID is duplicated without explicit supersession.');
    activeDefinitions.push(...stageDefinitions);
    if (stageIndex === activeRevisionIndex) currentRevisionLock = lock;
  }
  revisionAssertionDefinitions = activeDefinitions;
  affectedGoldenMasters = [...new Set(currentRevisionLock.requestedChanges.flatMap((change) => change.affectedGoldenMasters ?? []))].sort();
  if (affectedGoldenMasters.length < 1 || !affectedGoldenMasters.every((id) => gmSet.has(id))) throw new Error('Revision mode affected Golden Master set is invalid.');
  const assetOwners = new Map();
  for (const request of currentRevisionLock.requestedChanges) for (const assetPath of request.requiredAssets) {
    const owner = assetOwners.get(assetPath) ?? { requestIds: new Set(), goldenMasters: new Set() };
    owner.requestIds.add(request.id);
    request.affectedGoldenMasters.forEach((gm) => owner.goldenMasters.add(gm));
    assetOwners.set(assetPath, owner);
  }
  revisionAssetDefinitions = [...assetOwners].sort(([left], [right]) => left.localeCompare(right)).map(([assetPath, owner]) => ({ path: assetPath, requestIds: [...owner.requestIds].sort(), goldenMasters: [...owner.goldenMasters].sort() }));
  const priorCritic = JSON.parse(await fs.readFile(activeRevisionStage.priorCriticPath, 'utf8'));
  baselineTarget = priorCritic.auditTarget;
  if (!baselineTarget || !/^[a-f0-9]{40}$/.test(baselineTarget.commit ?? '') || !/^[a-f0-9]{40}$/.test(baselineTarget.tree ?? '')) throw new Error('Revision mode lacks its immutable immediate-prior critic target.');
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim();
}

function scenarioSearch(scenario) {
  const query = new URLSearchParams({ gm: scenario.gm });
  if (scenario.responsive) query.set('rv', scenario.responsive);
  return '?' + query.toString();
}

function boundedString(value, maximum = 20000) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maximum);
}

async function collectPreStabilizationEvidence(session) {
  const frameTree = await session.send('Page.getFrameTree');
  const isolated = await session.send('Page.createIsolatedWorld', {
    frameId: frameTree.frameTree.frame.id,
    worldName: 'cats-tower-trusted-s02-pre-stabilization-observer',
    grantUniveralAccess: false
  });
  const expression = `(() => {
    const finite = (value) => Number.isFinite(value) ? Number(value.toFixed(4)) : null;
    const stage = document.querySelector('[data-testid="gm-stage"]');
    if (!stage) throw new Error('Pre-stabilization observer lacks the ordinary GM stage.');
    const visual = window.visualViewport;
    const visualViewport = visual ? {
      width: finite(visual.width), height: finite(visual.height), offsetLeft: finite(visual.offsetLeft), offsetTop: finite(visual.offsetTop),
      scale: finite(visual.scale), pageLeft: finite(visual.pageLeft), pageTop: finite(visual.pageTop)
    } : null;
    const motionGroups = [
      ['background', '[data-layer-kind="background"]'],
      ['cat-idle', '.cat-sprite'],
      ['enemy-idle', '.enemy-unit img'],
      ['offline-progress', '.offline-progress i'],
      ['combat-effects', '.attack-arc,.impact-burst,.damage-number,.defeat-dust,.reward-provisional']
    ];
    const targets = motionGroups.map(([kind, selector]) => ({
      kind,
      records: [...stage.querySelectorAll(selector)].map((element) => {
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          animationIterationCount: style.animationIterationCount,
          transitionDuration: style.transitionDuration
        };
      })
    }));
    return {
      initialScroll: { windowScrollX: finite(window.scrollX), windowScrollY: finite(window.scrollY), stageScrollTop: finite(stage.scrollTop) },
      visualViewport,
      reducedMotionPolicy: { prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, stabilizationApplied: false, targets }
    };
  })()`;
  const evaluated = await session.send('Runtime.evaluate', { contextId: isolated.executionContextId, expression, awaitPromise: true, returnByValue: true, timeout: 10000 });
  if (evaluated.exceptionDetails || !evaluated.result || !Object.hasOwn(evaluated.result, 'value')) throw new Error('Trusted pre-stabilization collection failed: ' + JSON.stringify(evaluated.exceptionDetails ?? evaluated.result));
  return evaluated.result.value;
}

async function collectDomInIsolatedWorld(scanAssets, requestAssertions, requestedAssets, allowedPaths, preStabilization, stabilizationSha256) {
    const stage = document.querySelector('[data-testid="gm-stage"]');
    if (!stage) throw new Error('The ordinary review route has no unique Golden Master stage.');
    const gameUi = stage.querySelector('[data-testid="game-ui"]');
    const finite = (value) => Number.isFinite(value) ? Number(value.toFixed(2)) : null;
    const rawRect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: finite(value.left), top: finite(value.top), right: finite(value.right), bottom: finite(value.bottom), width: finite(value.width), height: finite(value.height) };
    };
    const stageRect = stage.getBoundingClientRect();
    const localRect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: finite(value.left - stageRect.left),
        top: finite(value.top - stageRect.top),
        right: finite(value.right - stageRect.left),
        bottom: finite(value.bottom - stageRect.top),
        width: finite(value.width),
        height: finite(value.height)
      };
    };
    const scroll = (element) => ({
      scrollWidth: element?.scrollWidth ?? 0,
      clientWidth: element?.clientWidth ?? 0,
      scrollHeight: element?.scrollHeight ?? 0,
      clientHeight: element?.clientHeight ?? 0
    });
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const box = (element) => ({ visible: visible(element), rect: localRect(element), scroll: scroll(element) });
    const isAriaHidden = (element) => Boolean(element.closest('[aria-hidden="true"]'));
    const isInertOrHiddenFromInteraction = (element) => Boolean(element.closest('[inert],[aria-hidden="true"]'));
    const parseColor = (value) => {
      const match = /^rgba?\(\s*([0-9.]+)(?:\s+|\s*,\s*)([0-9.]+)(?:\s+|\s*,\s*)([0-9.]+)(?:\s*\/\s*|\s*,\s*)?([0-9.]*)\s*\)$/.exec(value);
      if (!match) return null;
      return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha: match[4] === '' ? 1 : Number(match[4]) };
    };
    const opaqueBackdrop = (element) => {
      const layers = [];
      let imageFree = true;
      for (let candidate = element; candidate; candidate = candidate.parentElement) {
        const candidateStyle = getComputedStyle(candidate);
        if (candidateStyle.backgroundImage !== 'none') imageFree = false;
        const color = parseColor(candidateStyle.backgroundColor);
        if (color && color.alpha > 0) layers.push(color);
        if (color?.alpha === 1) break;
      }
      if (layers.length === 0 || layers[layers.length - 1].alpha !== 1) return null;
      let composite = layers.pop();
      while (layers.length > 0) {
        const foreground = layers.pop();
        const alpha = foreground.alpha + composite.alpha * (1 - foreground.alpha);
        composite = {
          red: (foreground.red * foreground.alpha + composite.red * composite.alpha * (1 - foreground.alpha)) / alpha,
          green: (foreground.green * foreground.alpha + composite.green * composite.alpha * (1 - foreground.alpha)) / alpha,
          blue: (foreground.blue * foreground.alpha + composite.blue * composite.alpha * (1 - foreground.alpha)) / alpha,
          alpha
        };
      }
      return { ...composite, imageFree };
    };
    const relativeLuminance = (color) => {
      const channel = (value) => { const normalized = value / 255; return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
    };
    const contrastEvidence = (element, style, effectiveOpacity) => {
      const foreground = parseColor(style.color);
      const background = opaqueBackdrop(element);
      if (!foreground || !background) return { foregroundColor: style.color, backgroundColor: background ? `rgb(${background.red}, ${background.green}, ${background.blue})` : '', backdropOpaque: false, backdropImageFree: false, contrastRatio: null };
      const renderedForegroundAlpha = foreground.alpha * effectiveOpacity;
      const renderedForeground = renderedForegroundAlpha < 1 ? {
        red: foreground.red * renderedForegroundAlpha + background.red * (1 - renderedForegroundAlpha),
        green: foreground.green * renderedForegroundAlpha + background.green * (1 - renderedForegroundAlpha),
        blue: foreground.blue * renderedForegroundAlpha + background.blue * (1 - renderedForegroundAlpha)
      } : foreground;
      const light = Math.max(relativeLuminance(renderedForeground), relativeLuminance(background));
      const dark = Math.min(relativeLuminance(renderedForeground), relativeLuminance(background));
      return {
        foregroundColor: style.color,
        backgroundColor: `rgb(${finite(background.red)}, ${finite(background.green)}, ${finite(background.blue)})`,
        backdropOpaque: true,
        backdropImageFree: background.imageFree,
        contrastRatio: finite((light + 0.05) / (dark + 0.05))
      };
    };
    const textLeaf = (element) => {
      const style = getComputedStyle(element);
      const interactive = element.closest('button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="link"],[tabindex]:not([tabindex="-1"])');
      let effectiveOpacity = 1;
      for (let candidate = element; candidate && stage.contains(candidate); candidate = candidate.parentElement) {
        effectiveOpacity *= Number.parseFloat(getComputedStyle(candidate).opacity) || 0;
        if (candidate === stage) break;
      }
      const contrast = contrastEvidence(element, style, effectiveOpacity);
      return {
        text: String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role') ?? '',
        className: typeof element.className === 'string' ? element.className.slice(0, 240) : '',
        textRole: element.getAttribute('data-text-role') ?? '',
        transient: element.getAttribute('data-transient') === 'true',
        interactiveAncestor: Boolean(interactive),
        disabledAncestor: Boolean(interactive && (interactive.disabled || interactive.getAttribute('aria-disabled') === 'true')),
        effectiveOpacity: finite(effectiveOpacity),
        fontSize: finite(Number.parseFloat(style.fontSize)),
        fontWeight: finite(Number.parseFloat(style.fontWeight)),
        lineHeight: finite(Number.parseFloat(style.lineHeight)),
        rect: localRect(element),
        scroll: scroll(element),
        visible: visible(element),
        ...contrast
      };
    };
    const leafElements = [...stage.querySelectorAll('*')].filter((element) => {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(element.tagName) || isAriaHidden(element) || !visible(element)) return false;
      const direct = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      return direct && String(element.textContent ?? '').trim().length > 0;
    });
    const leafMost = (elements) => elements.filter((element) => !elements.some((other) => other !== element && element.contains(other)));
    const primaryElements = leafMost([...new Set([...stage.querySelectorAll('[data-control-priority="primary"] [data-label], [data-control-priority="primary"] strong, [data-primary-label]')])].filter((element) => visible(element) && !isInertOrHiddenFromInteraction(element)));
    const criticalElements = leafMost([...new Set([...stage.querySelectorAll('[data-critical-label], .floor-marker strong, .battle-objective strong, .auto-chip, .enemy-hp, .party-state, .support-copy strong, #offline-title, .offline-state-label, [data-binding="offline.elapsed"], [data-binding="offline.outcome"] dt, [data-binding="offline.outcome"] dd')])].filter((element) => visible(element) && !isInertOrHiddenFromInteraction(element)));
    const navigationLabelElements = [...stage.querySelectorAll('[data-testid="bottom-nav"] button span,[data-testid="bottom-nav"] [data-nav-label]')].filter((element) => visible(element) && !isInertOrHiddenFromInteraction(element));
    const controlSelector = 'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="link"]';
    const controlRecord = (element) => {
      const style = getComputedStyle(element);
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role') ?? '',
        label: String(element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        href: element.getAttribute('href') ?? '',
        tabIndex: element.tabIndex,
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        importance: element.getAttribute('data-control-priority') === 'primary' ? 'primary' : 'important',
        fontSize: finite(Number.parseFloat(style.fontSize)),
        lineHeight: finite(Number.parseFloat(style.lineHeight)),
        rect: localRect(element),
        scroll: scroll(element),
        visible: visible(element)
      };
    };
    const navigationElement = stage.querySelector('[data-testid="bottom-nav"]');
    const navigationScrollInitial = stage.scrollTop;
    const navigationSafeProbe = document.createElement('div'); navigationSafeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom);'; document.body.append(navigationSafeProbe); const navigationSafeBottom = Number.parseFloat(getComputedStyle(navigationSafeProbe).paddingBottom) || 0; navigationSafeProbe.remove();
    let navigationScrollProbe = { performed: false, safeBottom: finite(navigationSafeBottom), scrollTopInitial: finite(navigationScrollInitial), scrollTopAfter: finite(navigationScrollInitial), scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight, navRectAfter: null, labelsAfter: [], controlsAfter: [], focusReached: false };
    if (navigationElement && Number.parseFloat(getComputedStyle(document.documentElement).fontSize) >= 31 && stage.scrollHeight > stage.clientHeight) {
      stage.scrollTop = Math.max(0, navigationElement.offsetTop + navigationElement.offsetHeight - stage.clientHeight + navigationSafeBottom);
      const navControls = [...navigationElement.querySelectorAll(controlSelector)].filter((element) => !isInertOrHiddenFromInteraction(element));
      navControls[0]?.focus({ preventScroll: true });
      navigationScrollProbe = { performed: true, safeBottom: finite(navigationSafeBottom), scrollTopInitial: finite(navigationScrollInitial), scrollTopAfter: finite(stage.scrollTop), scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight, navRectAfter: localRect(navigationElement), labelsAfter: [...navigationElement.querySelectorAll('button span,[data-nav-label]')].filter(visible).map(textLeaf), controlsAfter: navControls.map(controlRecord), focusReached: navControls.length > 0 && document.activeElement === navControls[0] };
      stage.scrollTop = navigationScrollInitial;
    }
    const controlElements = [...new Set([...stage.querySelectorAll(controlSelector)])].filter((element) => !isInertOrHiddenFromInteraction(element));
    const controls = controlElements.filter((element) => !controlElements.some((other) => other !== element && element.contains(other))).map(controlRecord);
    const indicatorRecords = [];
    const addIndicator = (kind, element) => {
      if (!element) return;
      indicatorRecords.push({
        kind,
        text: String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
        ariaLabel: element.getAttribute('aria-label') ?? '',
        nativeDisabled: Boolean(element.disabled),
        ariaDisabled: element.getAttribute('aria-disabled') ?? '',
        ariaSelected: element.getAttribute('aria-selected') ?? '',
        ariaCurrent: element.getAttribute('aria-current') ?? '',
        ariaValueNow: element.getAttribute('aria-valuenow') ?? '',
        ariaValueMax: element.getAttribute('aria-valuemax') ?? '',
        role: element.getAttribute('role') ?? '',
        visible: visible(element)
      });
    };
    for (const element of stage.querySelectorAll(':disabled,[aria-disabled="true"]')) addIndicator('disabled', element);
    for (const element of stage.querySelectorAll('[data-party-state="locked"],[data-state="locked"]')) addIndicator('locked', element);
    for (const element of stage.querySelectorAll('[aria-current="page"],[aria-selected="true"],[data-selected="true"],[data-party-state="field"]')) addIndicator('selected', element);
    for (const element of stage.querySelectorAll('[role="progressbar"][data-binding="enemy.hp"],[data-hp-current],.enemy-hp')) addIndicator('hp', element);
    const unit = (element) => {
      if (!element) return null;
      const art = element.matches('img,[data-asset-path]') ? element : element.querySelector('[data-asset-path][data-frame-id],img[data-asset-path]');
      const style = art ? getComputedStyle(art) : null;
      const parentRect = art?.offsetParent?.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const preTransformRect = art && parentRect ? {
        left: finite(parentRect.left - stageRect.left + art.offsetLeft),
        top: finite(parentRect.top - stageRect.top + art.offsetTop),
        right: finite(parentRect.left - stageRect.left + art.offsetLeft + art.offsetWidth),
        bottom: finite(parentRect.top - stageRect.top + art.offsetTop + art.offsetHeight),
        width: finite(art.offsetWidth),
        height: finite(art.offsetHeight)
      } : localRect(art);
      const transformMatrix = style && style.transform !== 'none'
        ? (() => { const matrix = new DOMMatrixReadOnly(style.transform); return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(finite); })()
        : [1, 0, 0, 1, 0, 0];
      return {
        canonicalId: element.getAttribute('data-cat-id') || element.getAttribute('data-enemy') || '',
        canonicalKind: element.getAttribute('data-enemy-kind') ?? '',
        visible: visible(element) && visible(art),
        rect: localRect(element),
        artRect: localRect(art),
        preTransformRect,
        sourceAsset: art?.getAttribute('data-asset-path') ?? '',
        sourceFrameId: art?.getAttribute('data-frame-id') ?? '',
        sourceUrl: art?.getAttribute('src') ?? '',
        objectFit: style?.objectFit ?? '',
        backgroundImage: style?.backgroundImage ?? '',
        backgroundSize: style?.backgroundSize ?? '',
        backgroundPosition: style?.backgroundPosition ?? '',
        transform: style?.transform ?? '',
        transformMatrix,
        transformOrigin: style?.transformOrigin ?? '',
        opacity: style ? finite(Number.parseFloat(style.opacity)) : null,
        declaredFootAnchor: {
          x: finite(Number.parseFloat(element.getAttribute('data-foot-anchor-x'))),
          y: finite(Number.parseFloat(element.getAttribute('data-foot-anchor-y')))
        }
      };
    };
    const markerSelectors = [
      ['anticipation', '[data-causality="anticipation"],.attack-anticipation,.motion-trail'],
      ['attack', '[data-event-type="combat.attack_started"]'],
      ['projectile-live', '[data-causality="projectile-live"],.projectile-arrow:not(.projectile-path-residue)'],
      ['projectile-path-residue', '[data-causality="projectile-path-residue"]'],
      ['impact-residue', '[data-causality="impact-residue"]'],
      ['damage', '[data-causality="damage"],.damage-number'],
      ['hit-reaction', '[data-causality="hit-reaction"],.enemy-unit.is-hit'],
      ['defeat', '[data-causality="defeat"][data-event-type="combat.entity_defeated"]'],
      ['reward-provisional', '[data-causality="reward-provisional"],.reward-provisional']
    ];
    const combatMarkers = [];
    for (const [kind, selector] of markerSelectors) {
      const element = stage.querySelector(selector);
      if (element) { const style = getComputedStyle(element); combatMarkers.push({
        kind, text: String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240), semanticShape: element.getAttribute('data-semantic-shape') ?? '', borderRightWidth: style.borderRightWidth, borderRadius: style.borderRadius, clipPath: style.clipPath, rect: localRect(element), visible: visible(element),
        eventId: element.getAttribute('data-event-id') ?? '', eventType: element.getAttribute('data-event-type') ?? '', simulationTick: element.getAttribute('data-simulation-tick') ?? '', stateVersion: element.getAttribute('data-state-version') ?? '',
        sourceEntityId: element.getAttribute('data-source-entity-id') ?? '', targetEntityId: element.getAttribute('data-target-entity-id') ?? '', entityId: element.getAttribute('data-entity-id') ?? '', causeEventId: element.getAttribute('data-cause-event-id') ?? '', attackEventId: element.getAttribute('data-attack-event-id') ?? '', projectileEntityId: element.getAttribute('data-projectile-entity-id') ?? '',
        arrivalEventId: element.getAttribute('data-arrival-event-id') ?? '', damageEventId: element.getAttribute('data-damage-event-id') ?? '', rewardEventId: element.getAttribute('data-reward-event-id') ?? '', settlementId: element.getAttribute('data-settlement-id') ?? '', currencyCanonicalId: element.getAttribute('data-currency-canonical-id') ?? '', amountDecimal: element.getAttribute('data-amount-decimal') ?? '', critical: element.getAttribute('data-critical') ?? '', defeatEventId: element.getAttribute('data-defeat-event-id') ?? '',
        effectClip: element.getAttribute('data-effect-clip') ?? '', flashActive: element.getAttribute('data-flash-active') ?? '', targetAnchor: element.getAttribute('data-target-anchor') ?? '',
        releaseEventId: element.getAttribute('data-release-event-id') ?? '', releaseEventType: element.getAttribute('data-release-event-type') ?? '', releaseSimulationTick: element.getAttribute('data-release-simulation-tick') ?? '', releaseStateVersion: element.getAttribute('data-release-state-version') ?? '', releaseSourceEntityId: element.getAttribute('data-release-source-entity-id') ?? '',
        spawnEventId: element.getAttribute('data-spawn-event-id') ?? '', spawnEventType: element.getAttribute('data-spawn-event-type') ?? '', spawnSimulationTick: element.getAttribute('data-spawn-simulation-tick') ?? '', spawnStateVersion: element.getAttribute('data-spawn-state-version') ?? '', spawnProjectileEntityId: element.getAttribute('data-spawn-projectile-entity-id') ?? '', spawnSourceEntityId: element.getAttribute('data-spawn-source-entity-id') ?? '', spawnTargetEntityId: element.getAttribute('data-spawn-target-entity-id') ?? '', spawnAttackEventId: element.getAttribute('data-spawn-attack-event-id') ?? ''
      }); }
    }
    const stateRecord = (element, index) => ({
      canonicalId: element.getAttribute('data-support-id') || element.getAttribute('data-party-id') || element.getAttribute('data-cat-id') || 'party-slot-' + String(index + 1),
      state: (element.getAttribute('data-support-state') || element.getAttribute('data-party-state') || [...element.classList].find((name) => name.startsWith('state-'))?.slice(6) || '').toLowerCase(),
      text: String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
      rect: localRect(element),
      visible: visible(element)
    });
    const partyStateRecord = (element, index) => {
      const base = stateRecord(element, index); const style = getComputedStyle(element); const before = getComputedStyle(element, '::before'); const after = getComputedStyle(element, '::after');
      return { ...base, semanticShape: element.getAttribute('data-semantic-shape') ?? '', iconPathData: [...element.querySelectorAll('.party-state svg path')].map((path) => path.getAttribute('d') ?? '').join('|').slice(0, 1000), borderStyle: style.borderStyle, borderWidth: style.borderWidth, borderRadius: style.borderRadius, clipPath: style.clipPath, beforeContent: before.content, beforeClipPath: before.clipPath, afterContent: after.content, afterClipPath: after.clipPath };
    };
    const partyElements = [...stage.querySelectorAll('[data-party-state],.party-card')];
    const supportElement = stage.querySelector('[data-support-state],.support-strip');
    const offlineElement = stage.querySelector('[role="dialog"]');
    const offlineStateElement = offlineElement?.querySelector('[data-binding="offline.elapsed"]') ?? null;
    const offlineProgressElement = stage.querySelector('[data-binding="offline.progress"]');
    const offlineHead = offlineElement?.querySelector('.offline-modal-head') ?? null;
    const offlineBody = offlineElement?.querySelector('.offline-modal-body') ?? null;
    const offlineFooter = offlineElement?.querySelector('.offline-modal-footer') ?? null;
    const offlineScrollInitial = offlineBody?.scrollTop ?? 0;
    const offlineHeadRectInitial = localRect(offlineHead);
    const offlineFooterRectInitial = localRect(offlineFooter);
    if (offlineBody && Number.parseFloat(getComputedStyle(document.documentElement).fontSize) >= 31) offlineBody.scrollTop = Math.min(96, Math.max(0, offlineBody.scrollHeight - offlineBody.clientHeight));
    const offlineScrollAfter = offlineBody?.scrollTop ?? 0;
    const stageImages = [...stage.querySelectorAll('img')].map((image) => ({
      source: image.getAttribute('src') ?? '', complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight
    }));
    const largeImageLayers = [...stage.querySelectorAll('*')].map((element) => {
      const style = getComputedStyle(element);
      const rect = localRect(element);
      return {
        tagName: element.tagName.toLowerCase(), kind: element.getAttribute('data-layer-kind') ?? '', sourceAsset: element.getAttribute('data-asset-path') ?? element.getAttribute('src') ?? '',
        backgroundImage: style.backgroundImage ?? '', rect, visible: visible(element)
      };
    }).filter((entry) => entry.visible && entry.rect && entry.rect.width * entry.rect.height >= stageRect.width * stageRect.height * 0.45 && (entry.backgroundImage.includes('url(') || ['img', 'canvas', 'picture', 'video'].includes(entry.tagName)));
    const origin = location.origin;
    const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const parsedResources = resourceUrls.map((url) => { try { return { url, parsed: new URL(url) }; } catch { return { url, parsed: null }; } });
    const externalResources = parsedResources.filter(({ parsed }) => !parsed || parsed.origin !== origin || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '').map(({ url }) => url);
    const resourcePaths = parsedResources.filter(({ parsed }) => parsed && parsed.origin === origin && parsed.username === '' && parsed.password === '' && parsed.search === '' && parsed.hash === '').map(({ parsed }) => parsed.pathname);
    if (externalResources.length > 0 || resourcePaths.some((resourcePath) => !allowedPaths.includes(resourcePath))) throw new Error('A browser resource escaped the exact same-origin review-manifest graph.');
    const manifestResponse = await fetch('./asset-manifest.json', { cache: 'no-store' });
    const manifest = await manifestResponse.json();
    const assetFrames = [];
    const toHex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    for (const asset of scanAssets ? (manifest.assets ?? []) : []) {
      for (const frame of asset.frames ?? []) {
        const image = new Image();
        image.decoding = 'sync';
        image.src = './' + asset.path;
        await image.decode();
        const rect = frame.sourceRect;
        const canvas = document.createElement('canvas');
        canvas.width = rect.width;
        canvas.height = rect.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.clearRect(0, 0, rect.width, rect.height);
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        const pixels = context.getImageData(0, 0, rect.width, rect.height).data;
        let left = rect.width;
        let top = rect.height;
        let right = -1;
        let bottom = -1;
        let opaquePixelCount = 0;
        const totalPixelCount = rect.width * rect.height;
        const alphaThreshold = 32;
        const minimumComponentRatio = 0.0025;
        const mask = new Uint8Array(totalPixelCount);
        const visited = new Uint8Array(totalPixelCount);
        const queue = new Int32Array(totalPixelCount);
        let candidateOpaquePixelCount = 0;
        for (let pixel = 0; pixel < totalPixelCount; pixel += 1) if (pixels[pixel * 4 + 3] >= alphaThreshold) { mask[pixel] = 1; candidateOpaquePixelCount += 1; }
        const minimumComponentPixels = Math.ceil(candidateOpaquePixelCount * minimumComponentRatio);
        for (let seed = 0; seed < totalPixelCount; seed += 1) {
          if (mask[seed] === 0 || visited[seed] === 1) continue;
          let head = 0; let tail = 0; let componentLeft = rect.width; let componentTop = rect.height; let componentRight = -1; let componentBottom = -1;
          visited[seed] = 1; queue[tail++] = seed;
          while (head < tail) {
            const pixel = queue[head++]; const x = pixel % rect.width; const y = Math.floor(pixel / rect.width);
            componentLeft = Math.min(componentLeft, x); componentTop = Math.min(componentTop, y); componentRight = Math.max(componentRight, x); componentBottom = Math.max(componentBottom, y);
            for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nextX = x + dx; const nextY = y + dy;
              if (nextX < 0 || nextX >= rect.width || nextY < 0 || nextY >= rect.height) continue;
              const next = nextY * rect.width + nextX;
              if (mask[next] === 1 && visited[next] === 0) { visited[next] = 1; queue[tail++] = next; }
            }
          }
          if (tail < minimumComponentPixels) continue;
          opaquePixelCount += tail;
          left = Math.min(left, componentLeft); top = Math.min(top, componentTop); right = Math.max(right, componentRight); bottom = Math.max(bottom, componentBottom);
        }
        const digest = await crypto.subtle.digest('SHA-256', pixels.buffer);
        assetFrames.push({
          path: asset.path,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          frameId: frame.id,
          sourceRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visibleBounds: { ...frame.visibleBounds },
          footAnchor: frame.footAnchor === null ? null : { ...frame.footAnchor },
          hitBounds: frame.hitBounds === null ? null : { ...frame.hitBounds },
          containsEffects: frame.containsEffects,
          alphaBounds: right < left ? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } : { left, top, right: right + 1, bottom: bottom + 1, width: right - left + 1, height: bottom - top + 1 },
          alphaThreshold,
          connectivity: 8,
          minimumComponentRatio,
          opaquePixelCount,
          totalPixelCount,
          pixelSha256: 'sha256:' + toHex(digest)
        });
      }
    }
    const safeProbe = document.createElement('div');
    safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.append(safeProbe);
    const probeStyle = getComputedStyle(safeProbe);
    const measuredSafeArea = {
      top: finite(Number.parseFloat(probeStyle.paddingTop)), right: finite(Number.parseFloat(probeStyle.paddingRight)),
      bottom: finite(Number.parseFloat(probeStyle.paddingBottom)), left: finite(Number.parseFloat(probeStyle.paddingLeft))
    };
    safeProbe.remove();
    const stringAt = (selector) => String(stage.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const dataBindings = [...stage.querySelectorAll('[data-binding]')].filter(visible).map((element) => ({
      id: element.getAttribute('data-binding') ?? '',
      text: String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
      visible: true,
      valueNow: element.getAttribute('aria-valuenow') ?? '',
      valueMax: element.getAttribute('aria-valuemax') ?? '',
      valueText: element.getAttribute('aria-valuetext') ?? '',
      state: element.getAttribute('data-support-state') ?? element.getAttribute('data-party-state') ?? element.getAttribute('data-reward-status') ?? '',
      autoStatus: element.getAttribute('data-auto-status') ?? '',
      statusVersion: element.getAttribute('data-reward-status-version') ?? '',
      amountDecimal: element.getAttribute('data-amount-decimal') ?? '',
      screenId: element.getAttribute('data-screen-id') ?? '',
      ariaCurrent: element.getAttribute('aria-current') ?? '',
      ariaDisabled: element.getAttribute('aria-disabled') ?? '',
      nativeDisabled: element.disabled ? 'true' : 'false',
      reviewInteraction: element.getAttribute('data-review-interaction') ?? '',
      applicationScope: element.getAttribute('data-application-scope') ?? '',
      targetEncounterId: element.getAttribute('data-target-encounter-id') ?? '',
      screenUiState: element.getAttribute('data-screen-ui-state') ?? '',
      objectiveCurrent: element.getAttribute('data-objective-current') ?? '',
      objectiveRequired: element.getAttribute('data-objective-required') ?? '',
      floorDecimal: element.getAttribute('data-floor-decimal') ?? '',
      eventId: element.getAttribute('data-event-id') ?? '', eventType: element.getAttribute('data-event-type') ?? '', simulationTick: element.getAttribute('data-simulation-tick') ?? '', stateVersion: element.getAttribute('data-state-version') ?? '',
      sourceEntityId: element.getAttribute('data-source-entity-id') ?? '', targetEntityId: element.getAttribute('data-target-entity-id') ?? '', entityId: element.getAttribute('data-entity-id') ?? '', causeEventId: element.getAttribute('data-cause-event-id') ?? '', attackEventId: element.getAttribute('data-attack-event-id') ?? '', projectileEntityId: element.getAttribute('data-projectile-entity-id') ?? '',
      arrivalEventId: element.getAttribute('data-arrival-event-id') ?? '', damageEventId: element.getAttribute('data-damage-event-id') ?? '', rewardEventId: element.getAttribute('data-reward-event-id') ?? '', settlementId: element.getAttribute('data-settlement-id') ?? '', currencyCanonicalId: element.getAttribute('data-currency-canonical-id') ?? '', critical: element.getAttribute('data-critical') ?? '', defeatEventId: element.getAttribute('data-defeat-event-id') ?? '',
      releaseEventId: element.getAttribute('data-release-event-id') ?? '', releaseEventType: element.getAttribute('data-release-event-type') ?? '', releaseSimulationTick: element.getAttribute('data-release-simulation-tick') ?? '', releaseStateVersion: element.getAttribute('data-release-state-version') ?? '', releaseSourceEntityId: element.getAttribute('data-release-source-entity-id') ?? '',
      spawnEventId: element.getAttribute('data-spawn-event-id') ?? '', spawnEventType: element.getAttribute('data-spawn-event-type') ?? '', spawnSimulationTick: element.getAttribute('data-spawn-simulation-tick') ?? '', spawnStateVersion: element.getAttribute('data-spawn-state-version') ?? '', spawnProjectileEntityId: element.getAttribute('data-spawn-projectile-entity-id') ?? '', spawnSourceEntityId: element.getAttribute('data-spawn-source-entity-id') ?? '', spawnTargetEntityId: element.getAttribute('data-spawn-target-entity-id') ?? '', spawnAttackEventId: element.getAttribute('data-spawn-attack-event-id') ?? ''
    }));
    const densityMetric = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return { fontSize: finite(Number.parseFloat(style.fontSize)), rect: localRect(element) };
    };
    const densityMetrics = {
      header: densityMetric(stage.querySelector('.game-hud')),
      resourceChips: [...stage.querySelectorAll('.resource-chip')].filter(visible).map(densityMetric),
      primaryControl: densityMetric(stage.querySelector('[data-control-priority="primary"]')),
      bottomNavigation: densityMetric(stage.querySelector('[data-testid="bottom-nav"]')),
      navigationControls: [...stage.querySelectorAll('[data-testid="bottom-nav"] button')].filter(visible).map(densityMetric)
    };
    const styleBox = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        rect: localRect(element),
        paddingTop: finite(Number.parseFloat(style.paddingTop)), paddingRight: finite(Number.parseFloat(style.paddingRight)),
        paddingBottom: finite(Number.parseFloat(style.paddingBottom)), paddingLeft: finite(Number.parseFloat(style.paddingLeft))
      };
    };
    const partyCardRects = [...stage.querySelectorAll('.party-card')].filter(visible).map(localRect);
    const partyInterCardGaps = [];
    for (let firstIndex = 0; firstIndex < partyCardRects.length; firstIndex += 1) for (let secondIndex = firstIndex + 1; secondIndex < partyCardRects.length; secondIndex += 1) {
      const first = partyCardRects[firstIndex]; const second = partyCardRects[secondIndex];
      const verticalOverlap = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      const horizontalOverlap = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
      if (verticalOverlap > 1) {
        const low = Math.min(first.left, second.left); const high = Math.max(first.right, second.right);
        const intervening = partyCardRects.some((candidate, candidateIndex) => candidateIndex !== firstIndex && candidateIndex !== secondIndex && Math.max(0, Math.min(first.bottom, candidate.bottom) - Math.max(first.top, candidate.top)) > 1 && candidate.left > low && candidate.right < high);
        if (!intervening) partyInterCardGaps.push({ firstIndex, secondIndex, axis: 'horizontal', gap: finite(Math.max(0, second.left - first.right, first.left - second.right)) });
      } else if (horizontalOverlap > 1) {
        const low = Math.min(first.top, second.top); const high = Math.max(first.bottom, second.bottom);
        const intervening = partyCardRects.some((candidate, candidateIndex) => candidateIndex !== firstIndex && candidateIndex !== secondIndex && Math.max(0, Math.min(first.right, candidate.right) - Math.max(first.left, candidate.left)) > 1 && candidate.top > low && candidate.bottom < high);
        if (!intervening) partyInterCardGaps.push({ firstIndex, secondIndex, axis: 'vertical', gap: finite(Math.max(0, second.top - first.bottom, first.top - second.bottom)) });
      }
    }
    const layoutMetrics = {
      header: styleBox(stage.querySelector('.game-hud')),
      battlefield: styleBox(stage.querySelector('[data-testid="battlefield"]')),
      partyCards: partyCardRects,
      partyInterCardGaps,
      primaryControl: styleBox(stage.querySelector('[data-control-priority="primary"]')),
      bottomNavigation: styleBox(stage.querySelector('[data-testid="bottom-nav"]')),
      navigationControls: [...stage.querySelectorAll('[data-testid="bottom-nav"] button')].filter(visible).map(styleBox)
    };
    const surfaceRecord = (name, element) => {
      if (!element) return null;
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      let transformMatrix = null;
      if (style.transform !== 'none') { const matrix = new DOMMatrixReadOnly(style.transform); transformMatrix = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(finite); }
      const zoom = Number.parseFloat(style.zoom);
      return {
        name,
        transform: style.transform,
        transformMatrix,
        transformOrigin: style.transformOrigin,
        zoom: finite(Number.isFinite(zoom) ? zoom : 1),
        rect: rawRect(element),
        rectToLayoutViewport: { width: finite(rect.width / innerWidth), height: finite(rect.height / innerHeight) }
      };
    };
    const surfaceGeometry = [
      surfaceRecord('html', document.documentElement),
      surfaceRecord('body', document.body),
      surfaceRecord('review-stage', document.querySelector('#review-stage')),
      surfaceRecord('gm-stage', stage),
      surfaceRecord('game-ui', gameUi)
    ];
    if (requestAssertions.some((assertion) => assertion.goldenMaster !== stage.dataset.gm)) throw new Error('Revision assertion escaped its exact data-gm root.');
    const requestMeasurements = requestAssertions.filter((assertion) => assertion.type !== 'ROI_PIXEL_DELTA').map((assertion) => {
      const matches = [...stage.querySelectorAll(assertion.selector)];
      const permitsAbsentBaseline = assertion.baselineMayBeAbsent === true && ['TEXT_EXACT', 'ELEMENT_VISIBLE'].includes(assertion.type);
      if (matches.length === 0 && permitsAbsentBaseline) {
        const observed = assertion.type === 'TEXT_EXACT'
          ? { selectorCount: 0, visible: false, text: '' }
          : { selectorCount: 0, visible: false, area: 0 };
        return { requestId: assertion.requestId, assertionId: assertion.id, criterionSha256: assertion.criterionSha256, type: assertion.type, goldenMaster: assertion.goldenMaster, observed };
      }
      if (matches.length !== 1) throw new Error(assertion.id + ': scoped selector must match exactly one ordinary element.');
      const element = matches[0];
      const elementVisible = visible(element);
      let observed;
      if (assertion.type === 'DOM_RECT_DELTA') {
        const rect = localRect(element);
        observed = { selectorCount: matches.length, visible: elementVisible, rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } };
      } else if (assertion.type === 'DOM_STYLE_DELTA') {
        observed = { selectorCount: matches.length, visible: elementVisible, value: getComputedStyle(element).getPropertyValue(assertion.property).trim().slice(0, 120) };
      } else if (assertion.type === 'TEXT_EXACT') {
        observed = { selectorCount: matches.length, visible: elementVisible, text: String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) };
      } else if (assertion.type === 'ELEMENT_VISIBLE') {
        const rect = element.getBoundingClientRect();
        const left = Math.max(rect.left, stageRect.left); const right = Math.min(rect.right, stageRect.right);
        const top = Math.max(rect.top, stageRect.top); const bottom = Math.min(rect.bottom, stageRect.bottom);
        observed = { selectorCount: matches.length, visible: elementVisible, area: finite(Math.max(0, right - left) * Math.max(0, bottom - top)) };
      } else throw new Error(assertion.id + ': unsupported isolated-world assertion type.');
      return { requestId: assertion.requestId, assertionId: assertion.id, criterionSha256: assertion.criterionSha256, type: assertion.type, goldenMaster: assertion.goldenMaster, observed };
    });
    const assetDomReferences = [];
    const assetDecoded = [];
    const manifestAssetPaths = (manifest.assets ?? []).map((asset) => asset.path);
    for (const assetPath of manifestAssetPaths) {
      const assetUrl = new URL(assetPath, location.href).href;
      let decoded = assetFrames.some((frame) => frame.path === assetPath);
      if (requestedAssets.includes(assetPath) && !decoded) {
        const decodeProbe = new Image();
        decodeProbe.decoding = 'sync';
        decodeProbe.src = assetUrl;
        await decodeProbe.decode();
        decoded = decodeProbe.complete && decodeProbe.naturalWidth > 0 && decodeProbe.naturalHeight > 0;
      }
      assetDecoded.push({ path: assetPath, decoded });
      for (const element of stage.querySelectorAll(`[data-asset-path="${CSS.escape(assetPath)}"]`)) {
        const rect = element.getBoundingClientRect();
        const visibleArea = Math.max(0, Math.min(rect.right, stageRect.right) - Math.max(rect.left, stageRect.left)) * Math.max(0, Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top));
        if (!visible(element) || visibleArea < 1) continue;
        const style = getComputedStyle(element);
        const references = [];
        if (element instanceof HTMLImageElement && new URL(element.currentSrc || element.src, location.href).href === assetUrl) references.push('src');
        for (const property of ['background-image', 'mask-image']) if (style.getPropertyValue(property).includes(`url("${assetUrl}")`) || style.getPropertyValue(property).includes(`url(${assetUrl})`)) references.push(property);
        for (const property of references) assetDomReferences.push({ path: assetPath, selector: `[data-asset-path="${assetPath}"]`, property, resolvedUrl: assetUrl, visibleArea: finite(visibleArea), surface: 'game' });
      }
    }
    if (requestedAssets.some((assetPath) => !manifestAssetPaths.includes(assetPath))) throw new Error('A required revision asset is absent from the exact route manifest.');
    return {
      externalResources,
      resourcePaths,
      environment: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        locale: navigator.language,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        visualViewport: preStabilization.visualViewport,
        reducedMotionPolicy: preStabilization.reducedMotionPolicy,
        captureStabilization: { appliedAfterPolicyCollection: true, cssSha256: stabilizationSha256 },
        surfaceGeometry,
        safeAreaInsets: measuredSafeArea,
        rootFontSize: finite(Number.parseFloat(getComputedStyle(document.documentElement).fontSize))
      },
      document: {
        ready: document.body.dataset.reviewReady ?? '', title: document.title.slice(0, 240),
        fixtureId: stage.dataset.fixtureId ?? '', synthetic: stage.dataset.synthetic ?? '', notRuntime: stage.dataset.notRuntime ?? '',
        layoutViewport: stage.dataset.layoutViewport ?? '', responsiveEvidenceOverride: stage.dataset.responsiveEvidenceOverride ?? '',
        gameUiInert: Boolean(gameUi?.inert), gameUiAriaHidden: gameUi?.getAttribute('aria-hidden') ?? '',
        bodyText: String(document.body.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 20000),
        stageText: String(stage.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 12000),
        gameUiText: String(gameUi?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 12000),
        stage: rawRect(stage), stageScroll: scroll(stage),
        documentScroll: scroll(document.documentElement),
        initialScrollX: preStabilization.initialScroll.windowScrollX,
        initialScrollY: preStabilization.initialScroll.windowScrollY,
        initialStageScrollTop: preStabilization.initialScroll.stageScrollTop
      },
      elements: {
        battlefield: box(stage.querySelector('[data-testid="battlefield"]')),
        bottomNavigation: box(stage.querySelector('[data-testid="bottom-nav"]')),
        navigationScrollProbe,
        partyDock: box(stage.querySelector('[data-testid="party-dock"],.party-dock')),
        enemy: unit(stage.querySelector('[data-enemy]')),
        cats: [...stage.querySelectorAll('[data-cat-id]')].map(unit),
        meaningfulText: leafElements.map(textLeaf), primaryLabels: primaryElements.map(textLeaf), navigationLabels: navigationLabelElements.map(textLeaf),
        controls, criticalLabels: criticalElements.map(textLeaf), semanticIndicators: indicatorRecords, combatMarkers,
        partyStates: partyElements.map(partyStateRecord),
        support: supportElement ? stateRecord(supportElement, 0) : null,
        offlineModal: offlineElement ? { label: String(offlineElement.getAttribute('aria-label') || offlineElement.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200), role: offlineElement.getAttribute('role') ?? '', ariaModal: offlineElement.getAttribute('aria-modal') ?? '', labelledBy: offlineElement.getAttribute('aria-labelledby') ?? '', elapsedSeconds: offlineStateElement?.getAttribute('data-elapsed-seconds') ?? '', capSeconds: offlineStateElement?.getAttribute('data-cap-seconds') ?? '', rect: localRect(offlineElement), visible: visible(offlineElement), controls: [...offlineElement.querySelectorAll(controlSelector)].map(controlRecord), fixedScrollProbe: { headInitial: offlineHeadRectInitial, headAfter: localRect(offlineHead), body: localRect(offlineBody), footerInitial: offlineFooterRectInitial, footerAfter: localRect(offlineFooter), scrollTopInitial: finite(offlineScrollInitial), scrollTopAfter: finite(offlineScrollAfter), scrollHeight: offlineBody?.scrollHeight ?? 0, clientHeight: offlineBody?.clientHeight ?? 0, bodyTabIndex: offlineBody?.getAttribute('tabindex') ?? '', bodyRole: offlineBody?.getAttribute('role') ?? '', bodyAriaLabel: offlineBody?.getAttribute('aria-label') ?? '' } } : null,
        offlineProgress: offlineProgressElement ? { role: offlineProgressElement.getAttribute('role') ?? '', ariaValueNow: offlineProgressElement.getAttribute('aria-valuenow') ?? '', ariaValueMax: offlineProgressElement.getAttribute('aria-valuemax') ?? '', rect: localRect(offlineProgressElement), visible: visible(offlineProgressElement) } : null,
        densityMetrics,
        layoutMetrics
      },
      assets: assetFrames,
      semantics: {
        floor: stringAt('.floor-marker strong,[data-floor]'),
        areaDisplay: stage.querySelector('[data-area-display]')?.getAttribute('data-area-display') ?? '',
        objective: stringAt('.battle-objective strong,[data-objective]'),
        killCounter: stringAt('.floor-progress strong,[data-kill-counter]'),
        currencies: [...stage.querySelectorAll('[data-currency],.resource-chip')].filter(visible).map((element) => String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)),
        ranks: [...stage.querySelectorAll('[data-rank],.profile-chip strong')].filter(visible).map((element) => String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)),
        rewardStates: combatMarkers.filter((entry) => entry.kind.startsWith('reward-')).map((entry) => ({ canonicalId: entry.kind, state: entry.kind.slice(7), text: entry.text, rect: entry.rect, visible: entry.visible })),
        partyStateLabels: partyElements.map((element) => String(element.querySelector('.party-state,[data-party-label]')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)),
        stageImages,
        largeImageLayers,
        assetDomReferences,
        dataBindings
      },
      requestMeasurements,
      assetDomReferences,
      assetDecoded
    };
}

async function collectDom(page, session, scanAssets, requestAssertions = [], requestedAssets = [], resourceAllowlist = allowedResourcePaths, preStabilization) {
  const frameTree = await session.send('Page.getFrameTree');
  const isolated = await session.send('Page.createIsolatedWorld', {
    frameId: frameTree.frameTree.frame.id,
    worldName: 'cats-tower-trusted-s02-observer',
    grantUniveralAccess: false
  });
  const expression = '(' + collectDomInIsolatedWorld.toString() + ')(' + [JSON.stringify(scanAssets), JSON.stringify(requestAssertions), JSON.stringify(requestedAssets), JSON.stringify(resourceAllowlist), JSON.stringify(preStabilization), JSON.stringify(screenshotStabilizationSha256)].join(',') + ')';
  const evaluated = await session.send('Runtime.evaluate', {
    contextId: isolated.executionContextId,
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 20000
  });
  if (evaluated.exceptionDetails || !evaluated.result || !Object.hasOwn(evaluated.result, 'value')) {
    throw new Error('Trusted isolated-world collection failed: ' + JSON.stringify(evaluated.exceptionDetails ?? evaluated.result));
  }
  return evaluated.result.value;
}

async function collectReviewOnlyAssetReferences(page, session, assetPaths) {
  if (assetPaths.length === 0) return [];
  const frameTree = await session.send('Page.getFrameTree');
  const isolated = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frameTree.frame.id, worldName: 'cats-tower-trusted-s02-review-observer', grantUniveralAccess: false });
  const expression = `(() => {
    const stage = document.querySelector('[data-testid="gm-stage"]');
    const paths = ${JSON.stringify(assetPaths)};
    return paths.map((assetPath) => {
      const matches = [...document.querySelectorAll('[data-review-reference][data-asset-path="' + CSS.escape(assetPath) + '"]')].filter((element) => !stage?.contains(element));
      if (matches.length !== 1) throw new Error(assetPath + ': reviewOnly asset must have one outside-stage review reference.');
      const element = matches[0]; const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && area >= 64;
      const image = element instanceof HTMLImageElement ? element : element.querySelector('img');
      if (!visible || !image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0 || new URL(image.currentSrc || image.src, location.href).href !== new URL(assetPath, location.href).href) throw new Error(assetPath + ': reviewOnly asset is not visibly decoded in review chrome.');
      return { path: assetPath, selector: '[data-review-reference][data-asset-path="' + assetPath + '"]', property: 'src', resolvedUrl: new URL(image.currentSrc || image.src, location.href).href, visibleArea: Number(area.toFixed(2)), surface: 'review' };
    });
  })()`;
  const evaluated = await session.send('Runtime.evaluate', { contextId: isolated.executionContextId, expression, awaitPromise: true, returnByValue: true, timeout: 10000 });
  if (evaluated.exceptionDetails || !evaluated.result || !Object.hasOwn(evaluated.result, 'value')) throw new Error('Trusted review-only asset collection failed: ' + JSON.stringify(evaluated.exceptionDetails ?? evaluated.result));
  return evaluated.result.value;
}

async function collectOfflineVariant(page, session) {
  const frameTree = await session.send('Page.getFrameTree');
  const isolated = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frameTree.frame.id, worldName: 'cats-tower-trusted-s02-offline-observer', grantUniveralAccess: false });
  const expression = `(() => {
    const stage = document.querySelector('[data-testid="gm-stage"][data-gm="GM07"]');
    const gameUi = stage?.querySelector('[data-testid="game-ui"]');
    const layer = stage?.querySelector('[data-offline-view-state]');
    const dialog = layer?.querySelector('[role="dialog"]');
    if (!stage || !gameUi || !layer || !dialog) throw new Error('GM07 offline variant lacks the exact ordinary dialog contract.');
    const compact = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const elapsed = dialog.querySelector('[data-binding="offline.elapsed"]');
    const progress = dialog.querySelector('[data-binding="offline.progress"]');
    const wallet = gameUi.querySelector('[data-binding="wallet.runCoin"]');
    const amountRows = [...dialog.querySelectorAll('[data-binding="offline.outcome"] > div')].map((row) => ({
      term: compact(row.querySelector('dt')?.textContent),
      value: compact(row.querySelector('dd')?.textContent),
      currencyCanonicalId: row.querySelector('dd')?.getAttribute('data-currency-canonical-id') ?? '',
      amountDecimal: row.querySelector('dd')?.getAttribute('data-amount-decimal') ?? ''
    }));
    const actions = [...dialog.querySelectorAll('button')].map((button) => ({
      kind: button.hasAttribute('data-review-state-action') ? button.getAttribute('data-review-state-action') : button.hasAttribute('data-review-action') ? 'close' : '',
      label: compact(button.textContent),
      enabled: !button.disabled && button.getAttribute('aria-disabled') !== 'true',
      priority: button.getAttribute('data-control-priority') ?? ''
    }));
    const shapeElement = dialog.querySelector('.offline-state-label[data-semantic-shape]');
    const shapeStyle = getComputedStyle(shapeElement);
    return {
      fixtureId: stage.dataset.fixtureId ?? '', synthetic: stage.dataset.synthetic ?? '', notRuntime: stage.dataset.notRuntime ?? '',
      screenUiState: gameUi.getAttribute('data-screen-ui-state') ?? '', gameUiInert: Boolean(gameUi.inert), gameUiAriaHidden: gameUi.getAttribute('aria-hidden') ?? '',
      dialog: {
        role: dialog.getAttribute('role') ?? '', ariaModal: dialog.getAttribute('aria-modal') ?? '', labelledBy: dialog.getAttribute('aria-labelledby') ?? '', describedBy: dialog.getAttribute('aria-describedby') ?? '',
        title: compact(dialog.querySelector('#offline-title')?.textContent), stateLabel: compact(dialog.querySelector('.offline-state-label[data-semantic-shape]')?.textContent), description: compact(elapsed?.textContent),
        elapsedSeconds: elapsed?.getAttribute('data-elapsed-seconds') ?? '', capSeconds: elapsed?.getAttribute('data-cap-seconds') ?? '', capDisplay: elapsed?.getAttribute('data-cap-display') ?? '',
        viewState: layer.getAttribute('data-offline-view-state') ?? '', settlementId: layer.getAttribute('data-settlement-id') ?? '', statusVersion: layer.getAttribute('data-status-version') ?? '', retryCapability: layer.getAttribute('data-retry-capability') ?? '',
        semanticShape: { id: shapeElement.getAttribute('data-semantic-shape') ?? '', borderTopWidth: shapeStyle.borderTopWidth, borderRightWidth: shapeStyle.borderRightWidth, borderStyle: shapeStyle.borderStyle, borderRadius: shapeStyle.borderRadius, clipPath: shapeStyle.clipPath },
        amountRows,
        progress: progress ? { present: true, kind: progress.getAttribute('data-progress-kind') ?? '', role: progress.getAttribute('role') ?? '', ariaValueNow: progress.getAttribute('aria-valuenow') ?? '', ariaValueMax: progress.getAttribute('aria-valuemax') ?? '', progressRatioDecimal: progress.getAttribute('data-progress-ratio-decimal') ?? '', fixtureClaimOnly: progress.getAttribute('data-fixture-claim-only') ?? '', notRuntimeAuthority: progress.getAttribute('data-not-runtime-authority') ?? '' } : { present: false, kind: 'none', role: '', ariaValueNow: '', ariaValueMax: '', progressRatioDecimal: '', fixtureClaimOnly: '', notRuntimeAuthority: '' },
        actions,
        walletAmountDecimal: wallet?.getAttribute('data-amount-decimal') ?? '', walletText: compact(wallet?.textContent)
      }
    };
  })()`;
  const evaluated = await session.send('Runtime.evaluate', { contextId: isolated.executionContextId, expression, awaitPromise: true, returnByValue: true, timeout: 10000 });
  if (evaluated.exceptionDetails || !evaluated.result || !Object.hasOwn(evaluated.result, 'value')) throw new Error('Trusted offline-state collection failed: ' + JSON.stringify(evaluated.exceptionDetails ?? evaluated.result));
  return evaluated.result.value;
}

async function collectBrowserModes(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ja-JP', colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const consoleErrors = []; const pageErrors = []; const failedRequests = []; const unexpectedResponses = []; const requestedUrls = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(boundedString(message.text(), 2000)); });
  page.on('pageerror', (error) => pageErrors.push(boundedString(error.message, 2000)));
  page.on('request', (request) => requestedUrls.push(request.url()));
  page.on('requestfailed', (request) => failedRequests.push(boundedString(request.url() + ' :: ' + (request.failure()?.errorText || 'failed'), 2000)));
  page.on('response', (response) => { if (response.status() >= 400) unexpectedResponses.push({ url: boundedString(response.url(), 2000), status: response.status() }); });
  const response = await page.goto(baseUrl + '?gm=GM05', { waitUntil: 'networkidle' });
  if (!response) throw new Error('Browser-mode review lacks its main document.');
  await page.waitForFunction(() => document.body.dataset.reviewReady === 'true');
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  const viewState = () => page.evaluate(() => {
    const surface = document.querySelector('#review-surface'); const reviewStage = document.querySelector('#review-stage'); const stage = document.querySelector('[data-testid="gm-stage"]');
    const fit = document.querySelector('#fit-view'); const actual = document.querySelector('#actual-button');
    const rect = stage.getBoundingClientRect(); const reviewStyle = getComputedStyle(reviewStage); const matrix = new DOMMatrixReadOnly(reviewStyle.transform);
    return {
      actualSizeClass: surface.classList.contains('is-actual-size'), fitAriaPressed: fit.getAttribute('aria-pressed') ?? '', actualAriaPressed: actual.getAttribute('aria-pressed') ?? '',
      nominalWidth: getComputedStyle(surface).getPropertyValue('--nominal-width').trim(), nominalHeight: getComputedStyle(surface).getPropertyValue('--nominal-height').trim(),
      reviewSizing: surface.dataset.reviewSizing ?? '', reviewScale: surface.dataset.reviewScale ?? '', viewportReadout: document.querySelector('#viewport-readout')?.textContent?.replace(/\s+/g, ' ').trim() ?? '', reviewTransform: reviewStyle.transform, reviewMatrixScaleX: Number(matrix.a.toFixed(6)),
      stageRect: { left: Number(rect.left.toFixed(2)), top: Number(rect.top.toFixed(2)), right: Number(rect.right.toFixed(2)), bottom: Number(rect.bottom.toFixed(2)), width: Number(rect.width.toFixed(2)), height: Number(rect.height.toFixed(2)) }
    };
  });
  const fitBefore = await viewState();
  await page.locator('#actual-button').click();
  await page.waitForFunction(() => document.querySelector('#review-surface')?.classList.contains('is-actual-size'));
  const actual = await viewState();
  await page.locator('#fit-view').click();
  await page.waitForFunction(() => !document.querySelector('#review-surface')?.classList.contains('is-actual-size'));
  const fitAfter = await viewState();
  const compareState = () => page.evaluate(() => {
    const surface = document.querySelector('#review-surface'); const reference = document.querySelector('#reference-compare'); const image = reference.querySelector('img'); const rect = reference.getBoundingClientRect(); const surfaceRect = surface.getBoundingClientRect();
    const rendered = !reference.hidden && getComputedStyle(reference).display !== 'none' && rect.width > 0 && rect.height > 0;
    const intersection = Math.max(0, Math.min(rect.right, surfaceRect.right) - Math.max(rect.left, surfaceRect.left)) * Math.max(0, Math.min(rect.bottom, surfaceRect.bottom) - Math.max(rect.top, surfaceRect.top));
    return {
      comparingClass: surface.classList.contains('is-comparing'), singleAriaPressed: document.querySelector('#single-view').getAttribute('aria-pressed') ?? '', compareAriaPressed: document.querySelector('#compare-button').getAttribute('aria-pressed') ?? '',
      referenceHidden: reference.hidden, referenceRendered: rendered, referenceViewportVisible: intersection >= 64, referenceOutsideStage: !document.querySelector('[data-testid="gm-stage"]').contains(reference),
      referenceDecoded: Boolean(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), surfaceScrollLeft: Number(surface.scrollLeft.toFixed(2))
    };
  });
  const closedBefore = await compareState();
  await page.locator('#compare-button').click();
  await page.waitForFunction(() => document.querySelector('#review-surface')?.classList.contains('is-comparing') && !document.querySelector('#reference-compare')?.hidden);
  await page.evaluate(() => { const surface = document.querySelector('#review-surface'); const reference = document.querySelector('#reference-compare'); surface.scrollLeft = reference.offsetLeft; });
  await page.waitForTimeout(50);
  const open = await compareState();
  await page.locator('#single-view').click();
  await page.waitForFunction(() => !document.querySelector('#review-surface')?.classList.contains('is-comparing') && document.querySelector('#reference-compare')?.hidden);
  const closedAfter = await compareState();
  const gmSwitches = [];
  for (const requested of scenarios.slice(0, 8).map((scenario) => scenario.gm)) {
    await page.locator(`[data-review-gm="${requested}"]`).click();
    await page.waitForFunction((gm) => document.body.dataset.reviewReady === 'true' && document.querySelector('[data-testid="gm-stage"]')?.dataset.gm === gm, requested);
    const record = await page.evaluate((gm) => {
      const selected = document.querySelector(`[data-review-gm="${gm}"]`); const stage = document.querySelector('[data-testid="gm-stage"]'); const gameUi = stage?.querySelector('[data-testid="game-ui"]'); const battlefield = stage?.querySelector('[data-testid="battlefield"]'); const url = new URL(location.href);
      const layout = (element) => ({ width: element?.offsetWidth ?? 0, height: element?.offsetHeight ?? 0, scrollWidth: element?.scrollWidth ?? 0, scrollHeight: element?.scrollHeight ?? 0 });
      return { requested: gm, routePath: url.pathname, routeSearch: url.search, stageGm: stage?.dataset.gm ?? '', fixtureId: stage?.dataset.fixtureId ?? '', layoutViewport: stage?.dataset.layoutViewport ?? '', responsiveEvidenceOverride: stage?.dataset.responsiveEvidenceOverride ?? '', selectedAriaCurrent: selected?.getAttribute('aria-current') ?? '', reviewId: document.querySelector('#review-id')?.textContent?.trim() ?? '', ready: document.body.dataset.reviewReady ?? '', stageLayout: layout(stage), gameUiLayout: layout(gameUi), battlefieldLayout: layout(battlefield) };
    }, requested);
    gmSwitches.push(record);
  }
  const expectedOrigin = new URL(baseUrl).origin;
  const externalResources = []; const resourcePaths = [];
  for (const requestedUrl of requestedUrls) {
    try {
      const parsed = new URL(requestedUrl); const isMain = parsed.pathname === expectedPath;
      const mainQueryValid = isMain && parsed.searchParams.size === 1 && /^GM0[1-8]$/.test(parsed.searchParams.get('gm') ?? '') && parsed.searchParams.has('gm');
      if (parsed.origin !== expectedOrigin || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '' || (isMain ? !mainQueryValid : parsed.search !== '') || (!isMain && !allowedResourcePaths.includes(parsed.pathname))) externalResources.push(boundedString(requestedUrl, 2000));
      else resourcePaths.push(parsed.pathname);
    } catch { externalResources.push(boundedString(requestedUrl, 2000)); }
  }
  await context.close();
  return {
    viewport: { width: 390, height: 844 },
    gmSwitches,
    fitActual: { fitBefore, actual, fitAfter },
    referenceCompare: { closedBefore, open, closedAfter },
    diagnostics: { consoleErrors, pageErrors, failedRequests, externalResources, resourcePaths: [...new Set(resourcePaths)].sort(), unexpectedResponses }
  };
}

let baselineAllowedResourcePaths = allowedResourcePaths;
if (revisionMode) {
  const response = await fetch(baselineBaseUrl + 'review-manifest.json', { cache: 'no-store', redirect: 'error' });
  const responseUrl = new URL(response.url);
  if (!response.ok || responseUrl.origin !== new URL(baselineBaseUrl).origin || responseUrl.username !== '' || responseUrl.password !== '' || responseUrl.pathname !== expectedPath + 'review-manifest.json' || responseUrl.search !== '' || responseUrl.hash !== '') throw new Error('Immediate-prior review manifest did not load from its exact credential-free local route.');
  const baselineReviewManifest = await response.json();
  baselineAllowedResourcePaths = [...new Set([expectedPath, expectedPath + 'review-manifest.json', ...(baselineReviewManifest.routeFiles ?? []).map((entry) => '/' + entry.path)])].sort();
}

await fs.rm(rawPath, { force: true });
await fs.rm(screenshotDirectory, { recursive: true, force: true });
await fs.rm(revisionDirectory, { recursive: true, force: true });
await fs.mkdir(screenshotDirectory, { recursive: true });
if (revisionMode) await fs.mkdir(baselineScreenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const baselineResults = [];
const currentRequestMeasurementMap = new Map();
const baselineRequestMeasurementMap = new Map();
const currentAssetObservations = [];
const offlineVariantResults = [];
let chromiumVersion = '';
let canonicalAssetEvidence = null;
let browserModes = null;

try {
  chromiumVersion = browser.version();
  browserModes = await collectBrowserModes(browser);
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: scenario.height },
      deviceScaleFactor: 1,
      locale: 'ja-JP',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    if (scenario.textScalePercent === 200) {
      await page.addInitScript(() => {
        const apply = () => document.documentElement?.style.setProperty('font-size', '200%', 'important');
        apply();
        new MutationObserver(apply).observe(document, { childList: true, subtree: true });
      });
    }
    if (scenario.safeArea) {
      await session.send('Emulation.setSafeAreaInsetsOverride', { insets: scenario.safeArea });
    }
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const unexpectedResponses = [];
    const resourceResponses = new Map();
    const resourceBodyPromises = [];
    let redirectCount = 0;
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(boundedString(message.text(), 2000)); });
    page.on('pageerror', (error) => pageErrors.push(boundedString(error.message, 2000)));
    page.on('requestfailed', (request) => failedRequests.push(boundedString(request.url() + ' :: ' + (request.failure()?.errorText || 'failed'), 2000)));
    page.on('response', (response) => {
      if (response.status() >= 400) unexpectedResponses.push({ url: boundedString(response.url(), 2000), status: response.status() });
      const record = { url: boundedString(response.url(), 2000), status: response.status(), contentType: boundedString(response.headers()['content-type'] ?? '', 240), sha256: '' };
      resourceResponses.set(response.url(), record);
      if (response.status() === 200 && /\/step4\/s02\/golden-master-p1\/assets\//.test(new URL(response.url()).pathname)) {
        resourceBodyPromises.push(response.body().then((bytes) => { record.sha256 = 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }));
      }
    });
    const search = scenarioSearch(scenario);
    const response = await page.goto(baseUrl + search, { waitUntil: 'networkidle' });
    if (!response) throw new Error(scenario.id + ': missing main-document response.');
    let request = response.request();
    while (request.redirectedFrom()) { redirectCount += 1; request = request.redirectedFrom(); }
    await page.waitForFunction(() => document.body.dataset.reviewReady === 'true', null, { timeout: 15000 });
    const preStabilization = await collectPreStabilizationEvidence(session);
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    const reviewAssetReferences = await collectReviewOnlyAssetReferences(page, session, referenceAssetPaths);
    const actualButton = page.locator('#actual-button');
    if (await actualButton.count() !== 1) throw new Error(scenario.id + ': ordinary review route has no exact 1:1 control.');
    if (!scenario.responsive) {
      await actualButton.click();
      await page.waitForFunction(() => document.querySelector('#review-surface')?.classList.contains('is-actual-size'));
    } else {
      await page.waitForFunction(() => !document.querySelector('#review-surface')?.classList.contains('is-actual-size'));
    }
    await page.addStyleTag({ content: screenshotStabilizationCss });
    const exactStage = page.locator(`[data-testid="gm-stage"][data-gm="${scenario.gm}"]`);
    if (await exactStage.count() !== 1) throw new Error(scenario.id + ': ordinary stage lacks its exact data-gm root.');
    const requestAssertions = scenario.id === scenario.gm ? revisionAssertionDefinitions.filter((assertion) => assertion.goldenMaster === scenario.gm) : [];
    const collected = await collectDom(page, session, canonicalAssetEvidence === null, requestAssertions, revisionAssetDefinitions.map((entry) => entry.path), allowedResourcePaths, preStabilization);
    await Promise.all(resourceBodyPromises);
    collected.semantics.reviewAssetReferences = reviewAssetReferences;
    if (canonicalAssetEvidence === null) canonicalAssetEvidence = collected.assets;
    else collected.assets = canonicalAssetEvidence;
    for (const measurement of collected.requestMeasurements) currentRequestMeasurementMap.set(measurement.assertionId, measurement);
    const screenshotName = scenario.id + '-' + String(scenario.width) + 'x' + String(scenario.height) + '.png';
    const screenshotPath = 'semantic-evidence/screenshots/' + screenshotName;
    const stageBox = await exactStage.boundingBox();
    if (!stageBox) throw new Error(scenario.id + ': exact GM stage has no screenshot bounds.');
    const bytes = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      omitBackground: false,
      captureBeyondViewport: true,
      clip: { x: Math.round(stageBox.x), y: Math.round(stageBox.y), width: scenario.width, height: scenario.height }
    });
    await fs.writeFile(path.join(root, screenshotPath), bytes);
    const actualUrl = new URL(page.url());
    results.push({
      id: scenario.id,
      gm: scenario.gm,
      state: scenario.state,
      viewport: { label: scenario.label, width: scenario.width, height: scenario.height },
      route: { path: actualUrl.pathname, search: actualUrl.search, status: response.status(), redirectCount },
      environment: { ...collected.environment, textScalePercent: scenario.textScalePercent ?? 100 },
      diagnostics: { consoleErrors, pageErrors, failedRequests, externalResources: collected.externalResources, resourcePaths: collected.resourcePaths, unexpectedResponses },
      document: collected.document,
      elements: collected.elements,
      assets: collected.assets,
      semantics: collected.semantics,
      screenshot: { path: screenshotPath, width: scenario.width, height: scenario.height, bytes: bytes.length, sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }
    });
    for (const assertion of requestAssertions.filter((entry) => entry.type === 'ROI_PIXEL_DELTA')) currentRequestMeasurementMap.set(assertion.id, { requestId: assertion.requestId, assertionId: assertion.id, criterionSha256: assertion.criterionSha256, type: assertion.type, goldenMaster: assertion.goldenMaster, observed: { screenshotPath, region: assertion.region } });
    if (scenario.id === scenario.gm) currentAssetObservations.push({ goldenMaster: scenario.gm, responses: [...resourceResponses.values()], references: [...collected.assetDomReferences, ...reviewAssetReferences], decoded: collected.assetDecoded });
    await context.close();
  }
  for (const viewState of offlineViewStates) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ja-JP', colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const consoleErrors = []; const pageErrors = []; const failedRequests = []; const unexpectedResponses = []; const externalResources = []; const resourcePaths = []; let redirectCount = 0;
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(boundedString(message.text(), 2000)); });
    page.on('pageerror', (error) => pageErrors.push(boundedString(error.message, 2000)));
    page.on('requestfailed', (request) => failedRequests.push(boundedString(request.url() + ' :: ' + (request.failure()?.errorText || 'failed'), 2000)));
    const expectedSearch = '?' + new URLSearchParams({ gm: 'GM07', offline: viewState }).toString();
    page.on('response', (response) => {
      if (response.status() >= 400) unexpectedResponses.push({ url: boundedString(response.url(), 2000), status: response.status() });
      try {
        const parsed = new URL(response.url()); const isMain = parsed.pathname === expectedPath;
        if (parsed.origin !== new URL(baseUrl).origin || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '' || (isMain ? parsed.search !== expectedSearch : parsed.search !== '') || (!isMain && !allowedResourcePaths.includes(parsed.pathname))) externalResources.push(boundedString(response.url(), 2000));
        else resourcePaths.push(parsed.pathname);
      } catch { externalResources.push(boundedString(response.url(), 2000)); }
    });
    const response = await page.goto(baseUrl + expectedSearch, { waitUntil: 'networkidle' });
    if (!response) throw new Error(viewState + ': missing offline-state main-document response.');
    let request = response.request(); while (request.redirectedFrom()) { redirectCount += 1; request = request.redirectedFrom(); }
    await page.waitForFunction(() => document.body.dataset.reviewReady === 'true', null, { timeout: 15000 });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important;transition:none!important}' });
    const collected = await collectOfflineVariant(page, session);
    const actualUrl = new URL(page.url());
    offlineVariantResults.push({
      viewState,
      route: { path: actualUrl.pathname, search: actualUrl.search, status: response.status(), redirectCount },
      diagnostics: { consoleErrors, pageErrors, failedRequests, externalResources, resourcePaths: [...new Set(resourcePaths)].sort(), unexpectedResponses },
      ...collected
    });
    await context.close();
  }
  if (revisionMode) {
    let baselineAssetEvidence = null;
    for (const scenario of scenarios.slice(0, 8)) {
      const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: 1, locale: 'ja-JP', colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const unexpectedResponses = [];
      const resourceResponses = new Map();
      const resourceBodyPromises = [];
      let redirectCount = 0;
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(boundedString(message.text(), 2000)); });
      page.on('pageerror', (error) => pageErrors.push(boundedString(error.message, 2000)));
      page.on('requestfailed', (request) => failedRequests.push(boundedString(request.url() + ' :: ' + (request.failure()?.errorText || 'failed'), 2000)));
      page.on('response', (response) => {
        if (response.status() >= 400) unexpectedResponses.push({ url: boundedString(response.url(), 2000), status: response.status() });
        const record = { url: boundedString(response.url(), 2000), status: response.status(), contentType: boundedString(response.headers()['content-type'] ?? '', 240), sha256: '' };
        resourceResponses.set(response.url(), record);
        if (response.status() === 200 && /\/step4\/s02\/golden-master-p1\/assets\//.test(new URL(response.url()).pathname)) resourceBodyPromises.push(response.body().then((bytes) => { record.sha256 = 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }));
      });
      const search = scenarioSearch(scenario);
      const response = await page.goto(baselineBaseUrl + search, { waitUntil: 'networkidle' });
      if (!response) throw new Error(scenario.id + ': missing baseline main-document response.');
      let request = response.request();
      while (request.redirectedFrom()) { redirectCount += 1; request = request.redirectedFrom(); }
      await page.waitForFunction(() => document.body.dataset.reviewReady === 'true', null, { timeout: 15000 });
      const preStabilization = await collectPreStabilizationEvidence(session);
      await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
      const reviewAssetReferences = [];
      const actualButton = page.locator('#actual-button');
      if (await actualButton.count() !== 1) throw new Error(scenario.id + ': baseline ordinary route has no exact 1:1 control.');
      await actualButton.click();
      await page.waitForFunction(() => document.querySelector('#review-surface')?.classList.contains('is-actual-size'));
      await page.addStyleTag({ content: screenshotStabilizationCss });
      const exactStage = page.locator(`[data-testid="gm-stage"][data-gm="${scenario.gm}"]`);
      if (await exactStage.count() !== 1) throw new Error(scenario.id + ': baseline ordinary stage lacks its exact data-gm root.');
      const currentRequestIds = new Set(currentRevisionLock.requestedChanges.map((request) => request.id));
      const requestAssertions = revisionAssertionDefinitions.filter((assertion) => assertion.goldenMaster === scenario.gm).map((assertion) => ({
        ...assertion,
        baselineMayBeAbsent: currentRequestIds.has(assertion.requestId) && ['TEXT_EXACT', 'ELEMENT_VISIBLE'].includes(assertion.type)
      }));
      const collected = await collectDom(page, session, baselineAssetEvidence === null, requestAssertions, [], baselineAllowedResourcePaths, preStabilization);
      await Promise.all(resourceBodyPromises);
      collected.semantics.reviewAssetReferences = reviewAssetReferences;
      if (baselineAssetEvidence === null) baselineAssetEvidence = collected.assets;
      else collected.assets = baselineAssetEvidence;
      for (const measurement of collected.requestMeasurements) baselineRequestMeasurementMap.set(measurement.assertionId, measurement);
      const screenshotName = scenario.id + '-' + String(scenario.width) + 'x' + String(scenario.height) + '.png';
      const screenshotPath = 'semantic-evidence/revision/before/' + screenshotName;
      const stageBox = await exactStage.boundingBox();
      if (!stageBox) throw new Error(scenario.id + ': baseline exact GM stage has no screenshot bounds.');
      const bytes = await page.screenshot({
        type: 'png',
        animations: 'disabled',
        omitBackground: false,
        captureBeyondViewport: true,
        clip: { x: Math.round(stageBox.x), y: Math.round(stageBox.y), width: scenario.width, height: scenario.height }
      });
      await fs.writeFile(path.join(root, screenshotPath), bytes);
      const actualUrl = new URL(page.url());
      baselineResults.push({
        id: scenario.id, gm: scenario.gm, state: scenario.state,
        viewport: { label: scenario.label, width: scenario.width, height: scenario.height },
        route: { path: actualUrl.pathname, search: actualUrl.search, status: response.status(), redirectCount },
        environment: { ...collected.environment, textScalePercent: 100 },
        diagnostics: { consoleErrors, pageErrors, failedRequests, externalResources: collected.externalResources, resourcePaths: collected.resourcePaths, unexpectedResponses },
        document: collected.document, elements: collected.elements, assets: collected.assets, semantics: collected.semantics,
        screenshot: { path: screenshotPath, width: scenario.width, height: scenario.height, bytes: bytes.length, sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }
      });
      for (const assertion of requestAssertions.filter((entry) => entry.type === 'ROI_PIXEL_DELTA')) baselineRequestMeasurementMap.set(assertion.id, { requestId: assertion.requestId, assertionId: assertion.id, criterionSha256: assertion.criterionSha256, type: assertion.type, goldenMaster: assertion.goldenMaster, observed: { screenshotPath, region: assertion.region } });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const currentRequestMeasurements = revisionMode ? revisionAssertionDefinitions.map((definition) => {
  const measurement = currentRequestMeasurementMap.get(definition.id);
  if (!measurement) throw new Error(definition.id + ': revised request measurement is absent.');
  return measurement;
}) : [];
const baselineRequestMeasurements = revisionMode ? revisionAssertionDefinitions.map((definition) => {
  const measurement = baselineRequestMeasurementMap.get(definition.id);
  if (!measurement) throw new Error(definition.id + ': baseline request measurement is absent.');
  return measurement;
}) : [];
const currentAssetParticipation = revisionMode ? revisionAssetDefinitions.map((owner) => {
  const domReferences = currentAssetObservations.flatMap((observation) => observation.references.filter((reference) => reference.path === owner.path).map((reference) => ({ goldenMaster: observation.goldenMaster, selector: reference.selector, property: reference.property, resolvedUrl: reference.resolvedUrl, visibleArea: reference.visibleArea, surface: reference.surface })));
  const uniqueReferences = [...new Map(domReferences.map((reference) => [JSON.stringify(reference), reference])).values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const goldenMasters = [...owner.goldenMasters];
  const requests = goldenMasters.map((goldenMaster) => {
    const observation = currentAssetObservations.find((entry) => entry.goldenMaster === goldenMaster);
    const assetUrl = new URL(owner.path, baseUrl).href;
    const response = observation?.responses.find((entry) => entry.url === assetUrl);
    const decoded = observation?.decoded.find((entry) => entry.path === owner.path)?.decoded === true;
    return { goldenMaster, url: assetUrl, status: response?.status ?? 0, contentType: response?.contentType ?? '', sha256: response?.sha256 ?? '', decoded };
  });
  return { path: owner.path, goldenMasters, requestIds: owner.requestIds, requests, domReferences: uniqueReferences };
}).sort((left, right) => left.path.localeCompare(right.path)) : [];

const raw = {
  schemaVersion: 1,
  artifactId: 'cats-tower-s02-golden-master-p1-browser-raw-round-001',
  repository,
  branch,
  head: process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']),
  tree: git(['rev-parse', 'HEAD^{tree}']),
  baseUrl,
  playwrightVersion: playwrightPackage.version,
  chromiumVersion,
  scenarios: results,
  offlineVariants: offlineVariantResults,
  browserModes,
  ...(revisionMode ? { requestMeasurements: currentRequestMeasurements, assetParticipation: currentAssetParticipation } : {})
};
await fs.writeFile(rawPath, JSON.stringify(raw, null, 2) + '\n');
if (revisionMode) {
  const baselineRaw = {
    schemaVersion: 1,
    artifactId: `cats-tower-s02-golden-master-p1-browser-before-raw-round-${activeRevisionStage.evidenceRound}`,
    repository,
    branch,
    head: baselineTarget.commit,
    tree: baselineTarget.tree,
    baseUrl: baselineBaseUrl,
    playwrightVersion: playwrightPackage.version,
    chromiumVersion,
    scenarios: baselineResults,
    requestMeasurements: baselineRequestMeasurements
  };
  await fs.writeFile(baselineRawPath, JSON.stringify(baselineRaw, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ artifactId: raw.artifactId, scenarioCount: raw.scenarios.length, rawPath: 'semantic-evidence/browser-raw.json' }) + '\n');
