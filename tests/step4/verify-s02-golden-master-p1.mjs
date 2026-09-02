#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const routePrefix = 'step4/s02/golden-master-p1/';
const reviewPrefix = 'quality-reviews/step-4-twelve-screen-final-mockups/';
const failures = [];
const checks = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
  return Boolean(condition);
}

function finiteInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function relative(target) {
  const resolved = path.resolve(root, target);
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) throw new Error(`Path escapes repository: ${target}`);
  return resolved;
}

function read(target) {
  const value = fs.readFileSync(relative(target));
  if (value.length === 0 || value.length > 10 * 1024 * 1024) throw new Error(`File size outside reviewed bounds: ${target}`);
  return value;
}

function text(target) {
  return read(target).toString('utf8');
}

function json(target) {
  const value = JSON.parse(text(target));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`JSON root must be an object: ${target}`);
  return value;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim();
}

function blobRecord(target) {
  const bytes = read(target);
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return {
    path: target,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    gitBlob: createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex')
  };
}

function addCheck(id, value, evidence) {
  checks.push({ id, value, evidence });
}

const repository = '2hg7trp7rv-design/cats_tower';
const branch = 'kimi';
const head = git(['rev-parse', 'HEAD']);
const tree = git(['rev-parse', 'HEAD^{tree}']);
check(/^[a-f0-9]{40}$/.test(head) && /^[a-f0-9]{40}$/.test(tree), 'Git HEAD/tree identity is invalid.');
check(git(['rev-parse', '--abbrev-ref', 'HEAD']) === branch || process.env.GITHUB_REF === 'refs/heads/kimi', 'Static verifier is not on kimi.');

const requiredRouteFiles = [
  `${routePrefix}index.html`,
  `${routePrefix}styles.css`,
  `${routePrefix}app.js`,
  `${routePrefix}golden-master-spec.json`,
  `${routePrefix}asset-manifest.json`,
  `${routePrefix}review-manifest.json`
];
const requiredHarnessFiles = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  'tests/step4/verify-s02-golden-master-p1.mjs',
  'tests/step4/s02-golden-master-p1-browser.mjs',
  'tests/step4/s02-golden-master-p1-browser-qa.mjs',
  'step4/s02/golden-master-p1/browser-qa/package.json',
  'step4/s02/golden-master-p1/browser-qa/package-lock.json'
];
const deliverables = [
  's02-golden-master-p1-acceptance-matrix-round-001.json',
  's02-golden-master-p1-competitive-research.md',
  's02-golden-master-p1-player-experience.json',
  's02-golden-master-p1-information-priority.json',
  's02-golden-master-p1-art-direction.json',
  's02-golden-master-p1-ui-design-system.json',
  's02-golden-master-p1-asset-decomposition.json',
  's02-golden-master-p1-animation-contract.json',
  's02-golden-master-p1-data-binding-matrix.json',
  's02-golden-master-p1-responsive-contract.json',
  's02-golden-master-p1-feasibility-audit.json'
];
for (const target of requiredRouteFiles) check(fs.existsSync(relative(target)) && fs.statSync(relative(target)).isFile(), `Required route file missing: ${target}`);
for (const target of requiredHarnessFiles) check(fs.existsSync(relative(target)) && fs.statSync(relative(target)).isFile(), `Required trusted-harness file missing: ${target}`);
for (const file of deliverables) check(fs.existsSync(relative(`${reviewPrefix}${file}`)) && fs.statSync(relative(`${reviewPrefix}${file}`)).isFile(), `Required S02 deliverable missing: ${file}`);

const index = text(`${routePrefix}index.html`);
const css = text(`${routePrefix}styles.css`);
const app = text(`${routePrefix}app.js`);
const routeSource = `${index}\n${css}\n${app}`;
for (const label of ['DESIGN REVIEW', 'S02 GOLDEN MASTER', 'NOT RUNTIME']) check(routeSource.includes(label), `Review boundary label missing: ${label}`);
for (let number = 1; number <= 8; number += 1) check(routeSource.includes(`GM${String(number).padStart(2, '0')}`), `Golden Master selector missing: GM${String(number).padStart(2, '0')}`);
check(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(routeSource), 'Emoji or pictographic Unicode is used as production UI.');
check(!/https?:\/\//i.test(routeSource), 'Review route contains an external runtime dependency.');
check(!/[?&]capture(?:=|&|['"`])/i.test(routeSource), 'Review route contains a capture-only rendering branch.');
check(!/(?:navigator\.(?:webdriver|userAgent)|HeadlessChrome|Playwright|semantic-evidence|GITHUB_SHA|location\.(?:port|host|hostname|origin)|127\.0\.0\.1|\b417[34]\b)/i.test(routeSource), 'Review route contains browser-runner, evidence-path, CI, or review-port detection.');
check(!/(?:searchParams|query)\.get\(\s*['"]viewport['"]\s*\)/i.test(app), 'Review route contains a viewport-query rendering branch instead of responding to the real viewport.');
check(!/<img[^>]+(?:golden-master|full-screen)[^>]*>/i.test(index), 'A complete Golden Master image is pasted into the review screen.');
check(!/<(?:canvas|picture|object|embed)\b/i.test(index) && !/createElement\(\s*['"](?:canvas|picture|object|embed)['"]\s*\)/i.test(app), 'Review route contains a flattened-screen-capable canvas/picture/object surface.');
check(!/(?:game-core|game-data|save-schema|payment|ad-network)/i.test(routeSource), 'P1 review route crosses a forbidden runtime/economy/backend boundary.');
check(routeSource.includes('data-testid="game-ui"'), 'Golden Master does not separate review labels from the game-UI composition.');
const scriptSources = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
const stylesheetSources = [...index.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
check(JSON.stringify(scriptSources) === JSON.stringify(['./app.js']), 'Review HTML script graph differs from the single reviewed app.js.');
check(JSON.stringify(stylesheetSources) === JSON.stringify(['./styles.css']), 'Review HTML stylesheet graph differs from the single reviewed styles.css.');
check(!/(?:^|[^\w])import\s*(?:\(|[^;]*from)|importScripts\s*\(|new\s+Worker\s*\(/m.test(app), 'Review app imports an unreviewed script/module/worker.');
const routeTreeFiles = [];
function collectRouteFiles(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collectRouteFiles(path.join(directory, entry.name), name);
    else if (entry.isFile()) routeTreeFiles.push(name);
    else fail(`Review route contains a non-regular filesystem entry: ${name}`);
  }
}
collectRouteFiles(relative(routePrefix));
check(routeTreeFiles.filter((target) => target.endsWith('.js')).every((target) => target === 'app.js'), 'Review route contains an unreviewed JavaScript file.');
check(routeTreeFiles.filter((target) => target.endsWith('.css')).every((target) => target === 'styles.css'), 'Review route contains an unreviewed stylesheet.');

const manifest = json(`${routePrefix}asset-manifest.json`);
check(hasExactKeys(manifest, ['schemaVersion', 'purpose', 'visibleBoundsContract', 'assets']), 'Asset manifest top-level key set differs from the reviewed schema.');
check(manifest.schemaVersion === 2, 'Asset manifest schemaVersion must be 2 for frame/anchor evidence.');
check(manifest.purpose === 'DESIGN_REVIEW_ONLY_NOT_RUNTIME', 'Asset manifest review-only boundary is missing.');
check(JSON.stringify(manifest.visibleBoundsContract) === JSON.stringify({ alphaThresholdInclusive: 32, connectivity: 8, discardComponentAreaBelowFractionOfOpaquePixels: 0.0025, bounds: 'union of retained components in sourceRect-local integer pixels' }), 'Asset manifest visibleBounds alpha/component contract differs from the reviewed production rule.');
check(Array.isArray(manifest.assets) && manifest.assets.length >= 5 && manifest.assets.length <= 40, 'Asset manifest count is implausible.');
const assetPaths = new Set();
let frameCount = 0;
let totalFramePixels = 0;
let separatedEffects = true;
let anchorsComplete = true;
const globalFrameIds = new Set();
check(JSON.stringify((manifest.assets ?? []).map((asset) => asset.path)) === JSON.stringify((manifest.assets ?? []).map((asset) => asset.path).sort()), 'Asset manifest paths are not in canonical sorted order.');
for (const asset of manifest.assets ?? []) {
  check(hasExactKeys(asset, ['path', 'kind', 'width', 'height', 'sha256', 'textBakedIn', 'runtimeUseAuthorized', 'includesEffects', 'includesCharacterPixels', 'reviewOnly', 'frames']), `Asset key set differs from schema: ${asset.path ?? ''}`);
  const assetPath = `${routePrefix}${asset.path ?? ''}`;
  check(typeof asset.path === 'string' && /^assets\/[a-z0-9][a-z0-9._/-]*\.(?:webp|png|svg)$/i.test(asset.path) && !asset.path.includes('..'), `Unsafe asset path: ${asset.path}`);
  check(!assetPaths.has(asset.path), `Duplicate asset path: ${asset.path}`);
  assetPaths.add(asset.path);
  check(fs.existsSync(relative(assetPath)) && fs.statSync(relative(assetPath)).isFile(), `Manifest asset is absent: ${asset.path}`);
  if (fs.existsSync(relative(assetPath))) {
    const bytes = read(assetPath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    check(asset.sha256 === digest, `Manifest SHA-256 differs: ${asset.path}`);
    if (asset.path.toLowerCase().endsWith('.svg')) check(!/<(?:text|foreignObject)\b/i.test(bytes.toString('utf8')), `SVG contains baked text or foreign content: ${asset.path}`);
  }
  check(asset.textBakedIn === (asset.kind === 'reference' && asset.reviewOnly === true) && asset.runtimeUseAuthorized === false, `Asset baked-text/runtime boundary is invalid: ${asset.path}`);
  check(['background', 'character', 'enemy', 'effect', 'ui', 'reference'].includes(asset.kind) && finiteInteger(asset.width, 1, 4096) && finiteInteger(asset.height, 1, 4096) && typeof asset.includesEffects === 'boolean' && typeof asset.includesCharacterPixels === 'boolean' && typeof asset.reviewOnly === 'boolean', `Asset metadata invalid: ${asset.path}`);
  check(asset.reviewOnly === (asset.kind === 'reference'), `Only reference assets may be reviewOnly: ${asset.path}`);
  check(!/full.?screen|golden.?master/i.test(asset.kind ?? ''), `Asset manifest contains a flattened full-screen Golden Master: ${asset.path}`);
  check(Array.isArray(asset.frames) && asset.frames.length > 0 && asset.frames.length <= 32, `Manifest asset lacks bounded sourceRect frame geometry: ${asset.path}`);
  for (const frame of asset.frames ?? []) {
    check(hasExactKeys(frame, ['id', 'sourceRect', 'visibleBounds', 'footAnchor', 'hitBounds', 'containsEffects']), `Frame key set differs from schema: ${asset.path}#${frame.id ?? ''}`);
    frameCount += 1;
    const rect = frame.sourceRect;
    const sourceGeometryValid = typeof frame.id === 'string' && frame.id.length > 0 && frame.id.length <= 80
      && rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.width <= 4096 && rect.height <= 4096 && rect.width * rect.height <= 4 * 1024 * 1024;
    check(sourceGeometryValid, `Invalid manifest sourceRect frame geometry: ${asset.path}#${frame.id ?? ''}`);
    const visibleBounds = frame.visibleBounds;
    check(visibleBounds && [visibleBounds.x, visibleBounds.y, visibleBounds.width, visibleBounds.height].every(Number.isSafeInteger) && visibleBounds.x >= 0 && visibleBounds.y >= 0 && visibleBounds.width > 0 && visibleBounds.height > 0 && visibleBounds.x + visibleBounds.width <= rect.width && visibleBounds.y + visibleBounds.height <= rect.height && typeof frame.containsEffects === 'boolean', `Frame visibleBounds/effect flag invalid: ${asset.path}#${frame.id ?? ''}`);
    if (sourceGeometryValid) totalFramePixels += rect.width * rect.height;
    check(!globalFrameIds.has(frame.id), `Duplicate global frame ID: ${frame.id}`);
    globalFrameIds.add(frame.id);
    if (asset.kind === 'character' || asset.kind === 'enemy') {
      const foot = frame.footAnchor;
      const hit = frame.hitBounds;
      const anchorGeometryValid = sourceGeometryValid
        && foot && Number.isFinite(foot.x) && Number.isFinite(foot.y) && foot.x >= 0 && foot.x <= rect.width && foot.y >= 0 && foot.y <= rect.height
        && hit && [hit.x, hit.y, hit.width, hit.height].every(Number.isFinite) && hit.x >= 0 && hit.y >= 0 && hit.width > 0 && hit.height > 0
        && hit.x + hit.width <= rect.width && hit.y + hit.height <= rect.height;
      if (!anchorGeometryValid) anchorsComplete = false;
    } else check(frame.footAnchor === null && frame.hitBounds === null, `Non-combat frame carries misleading foot/hit geometry: ${asset.path}#${frame.id ?? ''}`);
  }
  if ((asset.kind === 'character' || asset.kind === 'enemy') && asset.includesEffects !== false) separatedEffects = false;
  if (asset.kind === 'effect' && asset.includesCharacterPixels !== false) separatedEffects = false;
}
check(frameCount >= 9, 'Asset manifest must provide at least four roster, four action and one enemy frame.');
check(totalFramePixels > 0 && totalFramePixels <= 24 * 1024 * 1024, 'Decoded combat-frame pixel budget is outside the reviewed cap.');
const assetDirectory = relative(`${routePrefix}assets`);
const onDiskAssets = fs.existsSync(assetDirectory) ? fs.readdirSync(assetDirectory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => `assets/${entry.name}`).sort() : [];
check(JSON.stringify([...assetPaths].sort()) === JSON.stringify(onDiskAssets), 'Route asset directory and exact manifest asset set differ.');
const cssAssetReferences = [...css.matchAll(/url\(\s*["']?\.\/(assets\/[^"')?#]+)["']?\s*\)/gi)].map((match) => match[1]);
const htmlAssetReferences = [...index.matchAll(/<(?:img|source)\b[^>]*(?:src|srcset)=["']\.\/(assets\/[^"' ,]+)[^"']*["']/gi)].map((match) => match[1]);
const appAssetReferences = [...app.matchAll(/["']\.\/(assets\/[a-z0-9._/-]+\.(?:webp|png|svg))["']/gi)].map((match) => match[1]);
for (const referencedAsset of new Set([...cssAssetReferences, ...htmlAssetReferences, ...appAssetReferences])) check(assetPaths.has(referencedAsset), `Route source references an unmanifested asset: ${referencedAsset}`);

const acceptance = json(`${reviewPrefix}s02-golden-master-p1-acceptance-matrix-round-001.json`);
const playerExperience = json(`${reviewPrefix}s02-golden-master-p1-player-experience.json`);
const informationPriority = json(`${reviewPrefix}s02-golden-master-p1-information-priority.json`);
const artDirection = json(`${reviewPrefix}s02-golden-master-p1-art-direction.json`);
const uiSystem = json(`${reviewPrefix}s02-golden-master-p1-ui-design-system.json`);
const decomposition = json(`${reviewPrefix}s02-golden-master-p1-asset-decomposition.json`);
const animation = json(`${reviewPrefix}s02-golden-master-p1-animation-contract.json`);
const dataBinding = json(`${reviewPrefix}s02-golden-master-p1-data-binding-matrix.json`);
const responsive = json(`${reviewPrefix}s02-golden-master-p1-responsive-contract.json`);
const feasibility = json(`${reviewPrefix}s02-golden-master-p1-feasibility-audit.json`);

const canonicalDocuments = [
  ['s02-golden-master-p1-acceptance-matrix-round-001.json', acceptance, 'cats-tower-s02-golden-master-p1-acceptance-matrix-round-001'],
  ['s02-golden-master-p1-player-experience.json', playerExperience, 'cats-tower-s02-golden-master-p1-player-experience'],
  ['s02-golden-master-p1-information-priority.json', informationPriority, 'cats-tower-s02-golden-master-p1-information-priority'],
  ['s02-golden-master-p1-art-direction.json', artDirection, 'cats-tower-s02-golden-master-p1-art-direction'],
  ['s02-golden-master-p1-ui-design-system.json', uiSystem, 'cats-tower-s02-golden-master-p1-ui-design-system'],
  ['s02-golden-master-p1-asset-decomposition.json', decomposition, 'cats-tower-s02-golden-master-p1-asset-decomposition'],
  ['s02-golden-master-p1-animation-contract.json', animation, 'cats-tower-s02-golden-master-p1-animation-contract'],
  ['s02-golden-master-p1-data-binding-matrix.json', dataBinding, 'cats-tower-s02-golden-master-p1-data-binding-matrix'],
  ['s02-golden-master-p1-responsive-contract.json', responsive, 'cats-tower-s02-golden-master-p1-responsive-contract'],
  ['s02-golden-master-p1-feasibility-audit.json', feasibility, 'cats-tower-s02-golden-master-p1-feasibility-audit']
];
for (const [file, document, artifactId] of canonicalDocuments) check(document.schemaVersion === 2 && document.artifactId === artifactId && document.repository === repository && document.branch === branch, `Canonical A-J identity mismatch: ${file}`);
const documentDigests = Object.fromEntries([...canonicalDocuments.map(([file]) => file), 's02-golden-master-p1-competitive-research.md'].map((file) => [file, `sha256:${createHash('sha256').update(read(`${reviewPrefix}${file}`)).digest('hex')}`]));

const acceptanceText = JSON.stringify(acceptance);
const exactGoldenMasters = ['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08'];
const exactViewports = ['320x568', '320x667', '375x667', '360x800', '390x844', '412x915', '430x932'];
const reviewManifest = json(`${routePrefix}review-manifest.json`);
const goldenMasterSpec = json(`${routePrefix}golden-master-spec.json`);
const expectedDocumentRecords = deliverables.map((file) => blobRecord(`${reviewPrefix}${file}`)).sort((left, right) => left.path.localeCompare(right.path));
const expectedRouteRecords = [
  `${routePrefix}index.html`,
  `${routePrefix}styles.css`,
  `${routePrefix}app.js`,
  `${routePrefix}golden-master-spec.json`,
  `${routePrefix}asset-manifest.json`,
  ...[...assetPaths].map((assetPath) => `${routePrefix}${assetPath}`)
].map(blobRecord).sort((left, right) => left.path.localeCompare(right.path));
check(hasExactKeys(reviewManifest, ['schemaVersion', 'artifactId', 'purpose', 'repository', 'branch', 'route', 'goldenMasters', 'requiredViewports', 'documents', 'routeFiles']), 'Review manifest top-level key set differs from the exact binding schema.');
check(reviewManifest.schemaVersion === 2 && reviewManifest.artifactId === 'cats-tower-s02-golden-master-p1-review-manifest' && reviewManifest.purpose === 'DESIGN_REVIEW_ONLY_NOT_RUNTIME', 'Review manifest identity/boundary mismatch.');
check(reviewManifest.repository === repository && reviewManifest.branch === branch && reviewManifest.route === '/step4/s02/golden-master-p1/', 'Review manifest repository/branch/route mismatch.');
check(JSON.stringify(reviewManifest.goldenMasters) === JSON.stringify(exactGoldenMasters) && JSON.stringify(reviewManifest.requiredViewports) === JSON.stringify(exactViewports), 'Review manifest does not bind the exact GM and viewport sets.');
check(JSON.stringify(reviewManifest.documents) === JSON.stringify(expectedDocumentRecords), 'Review manifest document byte/SHA-256/Git-blob bindings differ from the exact 11 A-J deliverables.');
check(JSON.stringify(reviewManifest.routeFiles) === JSON.stringify(expectedRouteRecords), 'Review manifest route byte/SHA-256/Git-blob bindings differ from the exact reviewed route and asset graph.');
check(hasExactKeys(goldenMasterSpec, ['schemaVersion', 'artifactId', 'purpose', 'route', 'selectionContract', 'goldenMasters', 'responsiveEvidence', 'boundaries', 'depthContract']) && goldenMasterSpec.schemaVersion === 1 && goldenMasterSpec.artifactId === 'cats-tower-s02-golden-master-screen-spec-round-001' && goldenMasterSpec.purpose === 'DESIGN_REVIEW_ONLY_NOT_RUNTIME' && goldenMasterSpec.route === '/step4/s02/golden-master-p1/', 'Golden Master route specification identity/boundary mismatch.');
check(goldenMasterSpec.selectionContract === 'ordinary query only: ?gm=GM01 through ?gm=GM08; GM07 additionally accepts ?offline=<closed view state>; responsive acceptance accepts ?rv=<one exact responsiveEvidence token> and never changes the selected GM identity', 'Golden Master route selection/query contract differs from the exact ordinary-review boundary.');
check(hasExactKeys(goldenMasterSpec.depthContract, ['sortBasis', 'catFootAnchorSourcePx', 'enemyFootAnchorSourcePx']) && goldenMasterSpec.depthContract.sortBasis === 'computed world-space footAnchorY; slot index never controls depth' && JSON.stringify(goldenMasterSpec.depthContract.catFootAnchorSourcePx) === JSON.stringify({ x: 320, y: 720, sourceWidth: 640, sourceHeight: 768 }) && JSON.stringify(goldenMasterSpec.depthContract.enemyFootAnchorSourcePx) === JSON.stringify({ x: 657, y: 1023, sourceWidth: 1329, sourceHeight: 1183 }), 'Golden Master depth contract does not bind exact cat/enemy foot-anchor source geometry.');
check(JSON.stringify((goldenMasterSpec.goldenMasters ?? []).map((entry) => entry.id)) === JSON.stringify(exactGoldenMasters) && JSON.stringify(goldenMasterSpec.responsiveEvidence) === JSON.stringify(exactViewports), 'Golden Master route specification does not bind exact GMs/viewports.');
check(JSON.stringify(goldenMasterSpec.boundaries) === JSON.stringify({ namedPermanentPartySlots: 4, directTapDamage: false, activeSkillShown: false, runtimeUseAuthorized: false, completeScreenRasterAllowed: false, textBakedIntoImages: false }), 'Golden Master route specification violates the P1 runtime/fake-state boundary.');
check(Array.isArray(acceptance.goldenMasters) && JSON.stringify(acceptance.goldenMasters.map((entry) => typeof entry === 'string' ? entry : entry.id)) === JSON.stringify(exactGoldenMasters), 'Acceptance matrix does not bind the exact eight Golden Masters.');
check(JSON.stringify(acceptance.requiredViewports) === JSON.stringify(exactViewports), 'Acceptance matrix does not bind the exact seven required viewports.');
const exactQuantitativeAcceptance = {
  catVisibleAlphaHeightCssPx: { allRequiredMinimum: 60, reference390x844Minimum: 68 },
  enemyVisibleAlphaHeightCssPx: { allRequiredMinimum: 80, reference390x844Minimum: 96 },
  meaningfulTextMinimumCssPx: 14,
  metadataOnlyMinimumCssPx: 12,
  primaryTargetMinimumCssPx: 48,
  importantTargetMinimumCssPx: 44,
  targetBoxRule: 'min(rendered width, rendered height) must meet the applicable threshold',
  text200Scale: 2,
  text200Rule: 'computed font-size exact2.0x; no transform/zoom proxy',
  contrast: { normalTextMinimum: '4.5:1', largeTextMinimum: '3:1', largeTextEligibility: '>=24px normal or >=18.667px with weight>=700; otherwise4.5:1' },
  uniformScalingAllowed: false,
  horizontalUiOverflowAllowed: false
};
check(JSON.stringify(acceptance.quantitativeAcceptance) === JSON.stringify(exactQuantitativeAcceptance), 'Acceptance quantitative contract differs from the production thresholds.');
check(JSON.stringify(acceptance.evidenceBinding?.requiredCrossChecks) === JSON.stringify(['GM IDs and viewport labels match DOM', 'asset manifest enumerates every served file', 'no full-screen GM used as runtime asset', 'DOM computed sizes satisfy thresholds', 'visible-alpha bounds derive from decoded pixels or explicit transparent asset bounds', 'TEXT200 exact ratio', 'contrast from rendered colors', '4 labels exact', 'fixture watermark present']), 'Acceptance matrix evidence cross-check contract differs.');
check(/猫4体/.test(JSON.stringify(playerExperience)) && /5秒/.test(JSON.stringify(playerExperience)), 'Player experience does not lock four cats and five-second comprehension.');
check(['P0', 'P1', 'P2', 'P3'].every((priority) => JSON.stringify(informationPriority).includes(priority)), 'Information-priority map omits a required priority.');
check(JSON.stringify(artDirection).includes('PREMIUM_PIXEL_ART_CHIBI'), 'Art direction does not lock premium pixel-art chibi.');

const cssVariableDeclarations = [...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]);
const cssVariableReferences = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((match) => match[1]);
const appVariableDeclarations = [
  ...[...app.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/gi)].map((match) => match[1]),
  ...[...app.matchAll(/(?:style|cssText)[^\n]{0,500}(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1])
];
const declaredTokens = new Set([...cssVariableDeclarations, ...appVariableDeclarations]);
const undefinedTokens = [...new Set(cssVariableReferences.filter((name) => !declaredTokens.has(name)))];
const designTokenDriftCount = undefinedTokens.length;
check(css.includes('--grid-unit: 4px') || css.includes('--space-unit: 4px'), 'CSS does not lock a 4px base grid.');
const uiSystemText = JSON.stringify(uiSystem);
check(uiSystemText.includes('12') && uiSystemText.includes('14') && uiSystemText.includes('44') && uiSystemText.includes('48'), 'UI design system omits 12/14 px text or 44/48 CSS px hit-target rules.');
check(/contrast|コントラスト/i.test(uiSystemText) && /4\.5/.test(uiSystemText) && /3(?:\.0)?/.test(uiSystemText), 'UI design system omits WCAG 4.5:1 normal and 3:1 large-text contrast rules.');
check(/color|色/.test(uiSystemText) && /disabled|locked|selected|HP|無効|未解放|選択/i.test(uiSystemText), 'UI design system omits non-color state semantics.');

const responsiveViewports = Array.isArray(responsive.viewports) ? responsive.viewports : responsive.viewportContracts;
const viewportLabels = (responsiveViewports ?? []).map((entry) => typeof entry === 'string' ? entry : entry.viewport ?? entry.id);
check(JSON.stringify(viewportLabels) === JSON.stringify(exactViewports) && JSON.stringify(responsive.requiredViewports) === JSON.stringify(exactViewports), 'Responsive contract does not use the exact seven required viewports in order.');
const exactGlobalMinimums = { battlefieldCssPx: { short: 300, standard: 352, tall: 404 }, catVisibleAlphaHeightAllRequiredCssPx: 60, catVisibleAlphaHeightReference390x844CssPx: 68, enemyVisibleAlphaHeightAllRequiredCssPx: 80, enemyVisibleAlphaHeightReference390x844CssPx: 96, meaningfulTextCssPx: 14, metadataOnlyCssPx: 12, primaryTargetCssPx: 48, importantTargetMinimumCssPx: 44, targetGapCssPx: 8, bottomNavItemTargetCssPx: 48, rule: 'viewport不足を理由にminimumを下げずdocument flowを延ばす。' };
check(JSON.stringify(responsive.globalMinimums) === JSON.stringify(exactGlobalMinimums) && responsive.text200?.scale === 2, 'Responsive minimums do not repeat the exact Acceptance contract.');
check(/container\s*:\s*gmviewport\s*\/\s*size\b/.test(css) && (css.match(/@container\s+gmviewport\b/g) ?? []).length >= 5, 'Responsive implementation does not use the exact size-container recomposition contract.');
check(exactViewports.every((viewport) => app.includes(`'${viewport}'`)) && /(?:data-layout-viewport|dataset\.layoutViewport)/.test(app) && /(?:data-responsive-evidence-override|dataset\.responsiveEvidenceOverride)/.test(app), 'Route app does not bind all seven exact responsive-evidence viewport tokens to ordinary DOM evidence.');
const expectedCssTokens = { '--text-meaningful-min': '14px', '--text-metadata-min': '12px', '--target-primary-min': '48px', '--target-important-min': '44px', '--battlefield-short-min': '300px', '--battlefield-standard-min': '352px', '--battlefield-tall-min': '404px' };
for (const [token, value] of Object.entries(expectedCssTokens)) {
  check(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${value.replace('.', '\\.')}\\b`).test(css), `Responsive CSS token ${token} is not declared as ${value}.`);
  check(new RegExp(`var\\(\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`).test(css), `Responsive CSS token ${token} is declared but unused.`);
}
check(/safe.?area/i.test(JSON.stringify(responsive)) && /200/.test(JSON.stringify(responsive)), 'Responsive contract omits Safe Area or 200% text.');

check(JSON.stringify(uiSystem.typography?.minimums) === JSON.stringify({ meaningfulCssPx: 14, metadataOnlyCssPx: 12, metadataDefinition: '補助時刻、補助sequence、非操作のsecondary annotationに限定。state、action、navigation、amount、objectiveをmetadata扱いしない。', compactRule: '320pxでも縮めない。不足時はshorten、wrap、collapse、hideの順で対処。' }), 'UI typography minimums differ from Acceptance.');
check(uiSystem.interaction?.primaryTargetCssPx === 48 && uiSystem.interaction?.importantTargetMinimumCssPx === 44 && uiSystem.interaction?.targetGapMinimumCssPx === 8 && uiSystem.interaction?.onePrimaryPerState === true, 'UI interaction minimums differ from Acceptance.');
check(uiSystem.contrast?.normalTextMinimum === '4.5:1' && uiSystem.contrast?.largeTextMinimum === '3:1', 'UI contrast thresholds differ from Acceptance.');
check(uiSystem.battlePresentation?.catMinimumAllRequiredViewportsCssPx === 60 && uiSystem.battlePresentation?.catMinimumReference390x844CssPx === 68 && uiSystem.battlePresentation?.enemyMinimumAllRequiredViewportsCssPx === 80 && uiSystem.battlePresentation?.enemyMinimumReference390x844CssPx === 96, 'UI battle-presentation sizes differ from Acceptance.');

const bindingText = JSON.stringify(dataBinding);
check(!/FAKE_(?:REWARD|SKILL|SERVER)/i.test(bindingText), 'Data binding matrix contains a fake production state.');
const canonicalBindingIds = (dataBinding.bindings ?? []).map((binding) => binding.id);
const exactCanonicalBindingIds = ['review.watermark', 'screen.uiState', 'tower.floor', 'encounter.identity', 'encounter.objective', 'enemy.hp', 'enemy.hpBand', 'enemy.threat', 'battle.autoState', 'party.slotIdentity', 'party.slotState', 'party.allyHp', 'party.fieldEntity', 'combat.attack', 'combat.damage', 'combat.hit', 'combat.heal', 'combat.defeat', 'tower.floorTransition', 'party.faintState', 'battle.victoryState', 'reward.feedback', 'wallet.runCoin', 'wallet.ruby', 'profile.rank', 'support.temporary', 'support.shopDelivery', 'offline.elapsed', 'offline.progress', 'offline.outcome', 'settlement.status', 'navigation.primary', 'navigation.bottom', 'navigation.partyCard', 'navigation.supportSummary', 'tutorial.cue', 'feedback.toast', 'notification.badge', 'help.tooltip', 'state.cooldown', 'ui.interaction', 'error.recovery'];
check(JSON.stringify(canonicalBindingIds) === JSON.stringify(exactCanonicalBindingIds) && new Set(canonicalBindingIds).size === exactCanonicalBindingIds.length, 'Data binding matrix does not contain the exact ordered canonical binding ID set.');
const routeBindingIds = [...routeSource.matchAll(/data-binding\s*=\s*["']([a-zA-Z0-9._-]+)["']/g)].map((match) => match[1]);
check(routeBindingIds.length > 0 && routeBindingIds.every((id) => canonicalBindingIds.includes(id)), 'Route source declares a data-binding outside the canonical matrix.');
for (const id of ['review.watermark', 'screen.uiState', 'tower.floor', 'encounter.identity', 'encounter.objective', 'enemy.hp', 'battle.autoState', 'party.slotIdentity', 'party.slotState', 'party.allyHp', 'party.fieldEntity', 'wallet.runCoin', 'support.shopDelivery', 'navigation.primary', 'navigation.bottom']) check(routeBindingIds.includes(id), `Route source omits canonical data-binding: ${id}`);
const partyDecisionStates = (dataBinding.partyStateDecisionTable ?? []).map((entry) => [entry.result, entry.label]);
check(JSON.stringify(partyDecisionStates) === JSON.stringify([['field', '戦場参加中'], ['owned', '所有済み'], ['available', '加入可能'], ['locked', '未解放'], ['unknown', '状態確認中']]), 'Party decision table labels/states differ from the canonical five-state truth table.');
const gm08Labels = acceptance.goldenMasters?.find((entry) => entry.id === 'GM08')?.exactLabels;
check(JSON.stringify(gm08Labels) === JSON.stringify(['戦場参加中', '所有済み', '加入可能', '未解放']) && JSON.stringify(gm08Labels) === JSON.stringify(partyDecisionStates.slice(0, 4).map((entry) => entry[1])), 'GM08 labels do not cross-bind Acceptance and the data decision table.');
const exactFixtureWatermark = ['DESIGN REVIEW', 'S02 GOLDEN MASTER', 'NOT RUNTIME'];
const fixturePolicy = acceptance.reviewFixturePolicy;
const reviewFixtures = acceptance.reviewFixtures ?? [];
check(fixturePolicy?.schema === 'S02P1ReviewFixture/v1' && fixturePolicy.syntheticOnly === true && fixturePolicy.requiredFlags?.synthetic === true && fixturePolicy.requiredFlags?.notRuntime === true && JSON.stringify(fixturePolicy.requiredWatermark) === JSON.stringify(exactFixtureWatermark) && fixturePolicy.runtimeImportForbidden === true, 'Review fixture policy does not preserve the explicit synthetic/not-runtime boundary.');
check(reviewFixtures.length === 8 && JSON.stringify(reviewFixtures.map((fixture) => fixture.goldenMasterId)) === JSON.stringify(exactGoldenMasters) && JSON.stringify(reviewFixtures.map((fixture) => fixture.viewport)) === JSON.stringify(acceptance.goldenMasters.map((gm) => gm.viewport)), 'Review fixtures do not map one-to-one to Acceptance GMs/viewports.');
for (let index = 0; index < reviewFixtures.length; index += 1) {
  const fixture = reviewFixtures[index]; const gm = acceptance.goldenMasters[index];
  check(fixture.fixtureId === `s02.p1.fixture.${gm.id}` && gm.fixtureId === fixture.fixtureId && fixture.synthetic === true && fixture.notRuntime === true && JSON.stringify(fixture.watermark) === JSON.stringify(exactFixtureWatermark), `${gm.id}: review fixture identity/boundary mismatch.`);
}
const gm06Fixture = reviewFixtures.find((fixture) => fixture.goldenMasterId === 'GM06');
const gm06EventTypes = (gm06Fixture?.events ?? []).map((event) => event.type);
check(JSON.stringify(gm06EventTypes) === JSON.stringify(['combat.attack_started', 'combat.attack_released', 'combat.projectile_spawned', 'combat.projectile_arrived', 'combat.damage_applied', 'combat.entity_hit', 'combat.entity_defeated', 'reward.provisional']), 'GM06 fixture does not preserve attack/release/projectile-spawn/projectile-arrival/damage/hit/defeat/reward order.');
const gm06Reward = gm06Fixture?.events?.at(-1); const gm06Defeat = gm06Fixture?.events?.at(-2);
check(gm06Reward?.sourceEntityId === gm06Fixture?.enemy?.entityId && gm06Reward?.defeatEventId === gm06Defeat?.eventId && gm06Reward?.statusVersion === '1' && gm06Fixture?.walletRule?.beforeDecimal === gm06Fixture?.walletRule?.atCaptureDecimal && gm06Fixture?.walletRule?.uiMutation === false, 'GM06 reward source/version/defeat/wallet no-mutation contract is broken.');
check(gm06Fixture?.simulationTickDurationMs === '1' && gm06Fixture.events.every((event) => typeof event.eventId === 'string' && /^\d+$/.test(event.simulationTick) && /^\d+$/.test(event.stateVersion)), 'GM06 fixture lacks the explicit fixture-only tick duration or required event envelope fields.');
check(reviewFixtures.every((fixture) => fixture.support?.summaryState === 'SCHEDULED' && fixture.support?.display === '次戦支援 / 商会配送・適用予定' && fixture.support?.causality === 'next battle only; not applied to current encounter' && fixture.support?.applicationScope === 'NEXT_ENCOUNTER' && /^fixture\.s02\.[a-z0-9.-]+$/.test(fixture.support?.targetEncounterId ?? '')), 'A review fixture does not preserve namespaced next-battle-only scheduled support causality.');
const supportAdapter = (dataBinding.adapterResolutionDecisions ?? []).find((entry) => entry.id === 'ADAPTER-04');
check(supportAdapter?.closedSummaryStates?.includes('SCHEDULED') && supportAdapter?.scheduledGuard === 'SCHEDULED only when applicationScope=NEXT_ENCOUNTER and targetEncounterId is authoritative; otherwise UNKNOWN', 'Support adapter does not require an authoritative next-encounter target for SCHEDULED.');
const gm07FixtureStates = reviewFixtures.find((fixture) => fixture.goldenMasterId === 'GM07')?.offline?.stateVariants?.map((entry) => entry.viewState) ?? [];
const dataOfflineStates = (dataBinding.offlineViewStateDecisionTable ?? []).map((entry) => entry.viewState);
check(gm07FixtureStates.length === 10 && JSON.stringify(gm07FixtureStates) === JSON.stringify(dataOfflineStates), 'GM07 ten-state offline fixture and data decision table differ.');
check((dataBinding.settlementDecisionTable ?? []).some((entry) => entry.status === 'rejected' && /付与なし/.test(entry.display)) && (dataBinding.bindings ?? []).some((entry) => entry.id === 'reward.feedback' && /statusVersion/.test(entry.source)) && (dataBinding.bindings ?? []).some((entry) => entry.id === 'party.faintState') && (dataBinding.bindings ?? []).some((entry) => entry.id === 'battle.victoryState'), 'Data matrix omits rejected settlement, reward version/source, faint, or victory truth states.');
const gm08Fixture = reviewFixtures.find((fixture) => fixture.goldenMasterId === 'GM08');
const exactGm08BattlefieldEntities = [...(gm08Fixture?.party ?? []).filter((entry) => entry.state === 'field' && entry.battlefield === true).map((entry) => entry.characterId), gm08Fixture?.enemy?.entityId];
check(JSON.stringify(gm08Fixture?.battlefieldEntityIds) === JSON.stringify(exactGm08BattlefieldEntities) && (gm08Fixture?.party ?? []).filter((entry) => entry.state !== 'field').every((entry) => entry.battlefield === false && !gm08Fixture.battlefieldEntityIds.includes(entry.characterId)), 'GM08 fixture places a non-field party state on the battlefield.');
check(animation.stateToClip?.ally?.faint?.includes('ally.faint') && animation.stateToClip?.ally?.victory?.includes('ally.victory') && animation.stateToClip?.enemy?.defeat?.includes('enemy.defeat') && JSON.stringify(animation.eventInterface?.requiredEnvelopeFields) === JSON.stringify(['eventId', 'simulationTick', 'stateVersion']) && /event-specific IDs/.test(animation.eventInterface?.identityRule ?? '') && animation.eventInterface?.rewardFields?.includes('statusVersion'), 'Animation state-to-clip/event-envelope/reward statusVersion contract is incomplete.');
const exactInformationClasses = ['DELETE', 'P0_ALWAYS_REQUIRED', 'P1_ALWAYS_VISIBLE', 'P2_CONDITIONAL', 'P3_SEPARATE_SCREEN'];
check(JSON.stringify(Object.keys(informationPriority.classificationDefinitions ?? {}).sort()) === JSON.stringify([...exactInformationClasses].sort()) && JSON.stringify([...new Set((informationPriority.items ?? []).map((entry) => entry.classification))].sort()) === JSON.stringify([...exactInformationClasses].sort()), 'Information priority does not use the exact five canonical classifications.');

const animationText = JSON.stringify(animation);
check(['idle', 'walk', 'anticipation', 'attack', 'hit', 'faint', 'rewardReaction', 'victory'].every((state) => Object.hasOwn(animation.stateToClip?.ally ?? {}, state)) && ['idle', 'move', 'threat', 'attack', 'hit', 'defeat'].every((state) => Object.hasOwn(animation.stateToClip?.enemy ?? {}, state)), 'Animation state-to-clip map omits a required ally/enemy state.');
check(/footAnchor/.test(animationText) && /hitTarget/.test(animationText), 'Animation contract omits foot/hit anchors.');
check(/9.?slice|nine.?slice/i.test(JSON.stringify(uiSystem)) && /minimum/i.test(JSON.stringify(uiSystem)), 'UI system omits 9-slice cap/minimum rules.');
check((decomposition.characterModelSheet?.requiredAnchors ?? []).includes('foot') && (decomposition.characterModelSheet?.requiredAnchors ?? []).includes('hitTarget') && decomposition.enemy?.footAnchor && decomposition.enemy?.hitTarget && decomposition.enemy?.collisionBounds, 'Asset decomposition does not cross-bind required foot/hit/collision geometry.');
check(/sky|空/i.test(JSON.stringify(decomposition)) && /foreground|前景/i.test(JSON.stringify(decomposition)), 'Asset decomposition omits background depth layers.');
const feasibilityIds = (feasibility.auditItems ?? []).map((entry) => entry.id);
check(JSON.stringify(feasibilityIds) === JSON.stringify(Array.from({ length: 17 }, (_, index) => `FEAS-${String(index + 1).padStart(3, '0')}`)) && feasibility.auditItems.every((entry) => Array.isArray(entry.evidence) && entry.evidence.length > 0 && typeof entry.executionGate === 'string' && entry.executionGate.length > 0), 'Feasibility audit does not enumerate all 17 risks with evidence and execution gates.');
check(feasibility.defectSummary?.documentContractKnownP0 === 0 && feasibility.defectSummary?.documentContractKnownP1 === 0 && feasibility.defectSummary?.routeOrVisualP0 === 'NOT_ASSESSED_BY_THIS_CANDIDATE' && feasibility.defectSummary?.routeOrVisualP1 === 'NOT_ASSESSED_BY_THIS_CANDIDATE' && feasibility.defectSummary?.readyForUserReview === false, 'Feasibility audit improperly self-claims route/visual completion.');
check(JSON.stringify((feasibility.pendingGates ?? []).map((entry) => entry.id)) === JSON.stringify(['P1-GATE-001', 'P1-GATE-002', 'P1-GATE-003', 'P1-GATE-004', 'P1-GATE-005', 'P1-GATE-006']), 'Feasibility audit omits a required execution gate.');

const research = text(`${reviewPrefix}s02-golden-master-p1-competitive-research.md`);
const competitorSections = [...research.matchAll(/^###\s+\d+\.\s+(.+)$/gmi)].map((match) => match[1].trim());
const officialUrls = [...research.matchAll(/^- Official URL:\s+(https:\/\/\S+)$/gmi)].map((match) => match[1]);
const competitorCount = competitorSections.length;
const researchBlocks = research.split(/^###\s+\d+\.\s+/gmi).slice(1);
const researchCurrent = /^- Research date:\s*2026-09-02$/mi.test(research)
  && officialUrls.length === competitorCount
  && new Set(officialUrls).size === officialUrls.length
  && officialUrls.every((url) => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''; } catch { return false; } })
  && researchBlocks.length === competitorCount
  && researchBlocks.every((block) => /^- Source type:\s*(?:OFFICIAL_SITE|APP_STORE|GOOGLE_PLAY|OFFICIAL_VIDEO|DEVELOPER_MATERIAL)$/mi.test(block)
    && /^- Official source checked:\s*2026-09-02$/mi.test(block)
    && /^- Hands-on\/live UI verification:\s*NOT PERFORMED$/mi.test(block)
    && ['採用する抽象原則:', '採用しない点:', "Cat's Tower への変換:", 'コピー禁止:'].every((phrase) => block.includes(phrase)));
check(competitorCount >= 6 && competitorCount <= 10, 'Competitive research must contain 6-10 exact COMPETITOR sections.');
check(new Set(competitorSections).size === competitorSections.length, 'Competitive research contains duplicate works.');
check(researchCurrent, 'Competitive research date/official-primary-source coverage is incomplete.');
for (const phrase of ['採用する抽象原則:', '採用しない点:', "Cat's Tower への変換:", 'コピー禁止:']) check(research.includes(phrase), `Competitive research omits decision bridge: ${phrase}`);

const qaSource = text('tests/step4/s02-golden-master-p1-browser-qa.mjs');
const findingGroupAssertions = {
  VISIBLE_BOUNDS: ['VISIBLE_CAT_ALPHA_HEIGHT_MIN_60', 'VISIBLE_ENEMY_ALPHA_HEIGHT_MIN_80', 'STANDARD_CAT_ALPHA_HEIGHT_MIN_68', 'STANDARD_ENEMY_ALPHA_HEIGHT_MIN_96', 'TRANSPARENT_WRAPPER_EXCLUDED'],
  PARTY_ATLAS_ANCHOR: ['NON_UNIFORM_CHARACTER_SCALE_ABSENT', 'FOOT_AND_HIT_ANCHORS_BOUND', 'DEFEAT_POSE_VISUALLY_DISTINCT'],
  DESIGN_TOKEN_MINIMUM: ['MEANINGFUL_TEXT_MIN_14', 'METADATA_TEXT_MIN_12', 'PRIMARY_LABEL_MIN_14', 'PRIMARY_CONTROL_HIT_AREA_MIN_48', 'IMPORTANT_CONTROL_HIT_AREA_MIN_44', 'CONTROL_HIT_BOUNDS_NONOVERLAP', 'CONTROL_HIT_BOUNDS_MIN_GAP_8', 'MEANINGFUL_TEXT_CONTRAST_WCAG', 'STATE_SEMANTICS_NOT_COLOR_ONLY', 'DESIGN_TOKEN_DRIFT_ZERO'],
  RESPONSIVE_SAFEAREA: ['SEVEN_REQUIRED_VIEWPORTS_PASS', 'NONZERO_SAFE_AREA_PASS', 'TEXT_200_PERCENT_NO_LOSS', 'LAYOUT_AND_VISUAL_VIEWPORT_MATCH', 'INITIAL_SCROLL_ORIGIN_ZERO', 'UNIFORM_FULL_SCREEN_SCALE_ABSENT', 'REDUCED_MOTION_POLICY_NATIVE', 'REVIEW_BROWSER_MODES_OPERABLE', 'GM05_UI_ANTI_BLOAT', 'RESPONSIVE_GEOMETRY_CONTRACT', 'GM04_REFLOW_OR_SCROLL_PASS'],
  RESOURCE_RANK_BINDING: ['UNBOUND_RUBY_REMOVED', 'UNBOUND_RANK_REMOVED_OR_BOUND'],
  COMBAT_REWARD_CAUSALITY: ['KILL_COUNTER_AND_OBJECTIVE_CONSISTENT', 'REWARD_PROVISIONAL_NOT_CONFIRMED', 'ATTACK_HIT_DEFEAT_REWARD_CAUSALITY_VISIBLE'],
  SUPPORT_CAUSALITY: ['SUPPORT_NEXT_BATTLE_CAUSALITY_VISIBLE', 'GM04_SUPPORT_REMAINS_AVAILABLE'],
  OFFLINE_PARTY_SEMANTICS: ['OFFLINE_RECONCILIATION_ACCESSIBLE', 'PARTY_STATE_LABELS_CANONICAL', 'REVIEW_COPY_EXCLUDED_FROM_GAME_UI'],
  ASSET_SEPARATION: ['EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES', 'ANIMATION_ANCHORS_COMPLETE', 'NINE_SLICE_CAPS_AND_MINIMUMS_VALID'],
  TEST_RESEARCH_COVERAGE: ['PRIMARY_SOURCE_COMPETITORS_6_TO_10', 'OFFICIAL_SOURCE_CURRENT_LISTING_CHECKED', 'ALL_TEN_FINDING_GROUPS_AUTOMATED']
};
const qaAssertionCalls = [...qaSource.matchAll(/assertion\(\s*['"]([A-Z0-9_]+)['"]/g)].map((match) => match[1]);
const expectedQaAssertions = Object.values(findingGroupAssertions).flat();
const qaAssertionCounts = new Map(expectedQaAssertions.map((id) => [id, qaAssertionCalls.filter((candidate) => candidate === id).length]));
const automatedFindingGroupCount = Object.values(findingGroupAssertions).filter((ids) => ids.every((id) => qaAssertionCounts.get(id) === 1)).length;
check(JSON.stringify(qaAssertionCalls) === JSON.stringify(expectedQaAssertions), `Sole browser QA writer does not implement the exact ${expectedQaAssertions.length} assertion calls in finding-group order.`);

addCheck('DESIGN_TOKEN_DRIFT_ZERO', designTokenDriftCount, { declaredTokenCount: declaredTokens.size, undefinedTokens });
addCheck('CANONICAL_A_J_DOCUMENT_BLOBS_BOUND', Object.keys(documentDigests).length, { documents: documentDigests });
addCheck('EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES', separatedEffects, { assetCount: manifest.assets?.length ?? 0 });
addCheck('ANIMATION_ANCHORS_COMPLETE', anchorsComplete && /foot.?anchor/i.test(animationText) && /(hit.?bounds|hit.?target)/i.test(animationText), { frameCount });
addCheck('NINE_SLICE_CAPS_AND_MINIMUMS_VALID', /9.?slice|nine.?slice/i.test(JSON.stringify(uiSystem)) && /minimum/i.test(JSON.stringify(uiSystem)), { source: `${reviewPrefix}s02-golden-master-p1-ui-design-system.json` });
addCheck('PRIMARY_SOURCE_COMPETITORS_6_TO_10', competitorCount, { competitorSections, officialUrlCount: officialUrls.length });
addCheck('OFFICIAL_SOURCE_CURRENT_LISTING_CHECKED', researchCurrent, { researchDate: research.match(/^- Research date:\s*(.+)$/mi)?.[1] ?? null, officialUrlCount: officialUrls.length, officialSourceCheck: '2026-09-02', handsOnLiveUiVerification: 'NOT PERFORMED' });
addCheck('ALL_TEN_FINDING_GROUPS_AUTOMATED', automatedFindingGroupCount, { findingGroups: Object.keys(findingGroupAssertions), qaAssertionCounts: Object.fromEntries(qaAssertionCounts) });

const report = {
  schemaVersion: 2,
  artifactId: 'cats-tower-s02-golden-master-p1-static-evidence-round-002',
  repository,
  branch,
  head,
  tree,
  checks,
  failures,
  verdict: failures.length === 0 ? 'PASS_S02_GOLDEN_MASTER_P1_STATIC' : 'FAIL_S02_GOLDEN_MASTER_P1_STATIC',
  physicalIPhoneVerified: false,
  productionMutationPerformed: false
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
