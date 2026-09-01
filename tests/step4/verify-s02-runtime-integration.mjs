import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));
const exists = relative => fs.existsSync(path.join(root, relative));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const repository = '2hg7trp7rv-design/cats_tower';
const branch = 'kimi';
const visualRepairEntryHead = '9495c97232213620346958f271913fd8a585ff50';
const visualVersion = 's02-responsive-repair-round-002';
const responsiveStrategy = 'reference-width-reflow-safe-area';
const changeControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-025.json';
const parentAcceptancePath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-actual-root-visual-repair-acceptance-round-001.json';
const responsiveAcceptancePath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-actual-root-visual-repair-responsive-acceptance-round-002.json';

const requiredFiles = [
  'index.html',
  'app.js',
  'game-core.js',
  'game-data.js',
  'sw.js',
  'runtime/s02-runtime.css',
  'runtime/s02-runtime-fixes.css',
  'runtime/s02-runtime.js',
  'runtime/s02-battle-renderer.js',
  'tests/step4/verify-s02-runtime-integration.mjs',
  'tests/step4/s02-runtime-browser-qa.mjs',
  'tests/governance/verify-current-step2-state.mjs',
  '.github/workflows/verify-step-4-s02-runtime-integration.yml',
  changeControlPath,
  parentAcceptancePath,
  responsiveAcceptancePath
];
for (const file of requiredFiles) assert(exists(file), `Missing responsive visual-repair file: ${file}`);

assert((process.env.GITHUB_REPOSITORY ?? repository) === repository, 'Repository boundary mismatch.');
assert((process.env.GITHUB_REF_NAME ?? branch) === branch, 'Branch boundary mismatch.');
try {
  execFileSync('git', ['merge-base', '--is-ancestor', visualRepairEntryHead, 'HEAD'], { cwd: root, stdio: 'pipe' });
} catch {
  failures.push(`HEAD is not a descendant of visual repair entry ${visualRepairEntryHead}.`);
}

const rootHtml = read('index.html');
const runtimeCss = read('runtime/s02-runtime.css');
const runtimeFixes = read('runtime/s02-runtime-fixes.css');
const runtimeJs = read('runtime/s02-runtime.js');
const rendererJs = read('runtime/s02-battle-renderer.js');
const browserQa = read('tests/step4/s02-runtime-browser-qa.mjs');
const workflow = read('.github/workflows/verify-step-4-s02-runtime-integration.yml');
const changeControl = readJson(changeControlPath);
const parentAcceptance = readJson(parentAcceptancePath);
const responsiveAcceptance = readJson(responsiveAcceptancePath);

function viewportContent(html) {
  const tag = html.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i)?.[0]
    || html.match(/<meta\b[^>]*\bcontent=["'][^"']*["'][^>]*\bname=["']viewport["'][^>]*>/i)?.[0]
    || '';
  return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] || '';
}

const viewport = viewportContent(rootHtml);
assert(viewport.includes('width=device-width'), 'Root viewport width contract is missing.');
assert(viewport.includes('viewport-fit=cover'), 'Root safe-area viewport-fit contract is missing.');
assert(!/user-scalable\s*=\s*no/i.test(viewport), 'Root user zoom is disabled.');

for (const token of [
  'data-testid="s02-runtime-shell"',
  'runtime/s02-runtime.css',
  'runtime/s02-runtime-fixes.css',
  'runtime/s02-runtime.js',
  'id="battle"',
  'id="btn-summon"',
  'id="tower-list"',
  'id="btn-dawn"',
  'class="runtime-bottom-nav"'
]) assert(rootHtml.includes(token), `Root integration missing: ${token}`);
assert((rootHtml.match(/class="runtime-nav-button/g) || []).length === 5, 'Root must expose exactly five bottom navigation buttons.');
assert(!/<(?:iframe|object|embed)\b/i.test(rootHtml), 'Embedded-document integration is forbidden.');
assert(!/\son[a-z]+\s*=/i.test(rootHtml), 'Inline event handlers are forbidden.');

for (const token of [
  'window.__game',
  'mountActualStateRenderer',
  'mountVisualRepairLayer',
  'observeActualEvents',
  'window.__game.emit observer',
  'runtime-party-dock',
  'runtime-causality-strip',
  'runtime-encounter-panel',
  "battle.insertAdjacentElement('afterend', partyDock)",
  "partyDock.dataset.placement = 'after-battle'",
  'classifyViewport',
  "shell.dataset.responsiveStrategy = 'reference-width-reflow-safe-area'",
  'referenceWidthCssPx: 390',
  'minimumReadableTextCssPx: 11',
  'preferredTouchTargetCssPx: 48',
  'partySlots: 4',
  "clickExisting('#tab-agency'",
  "clickExisting('#tab-forge'",
  "clickExisting('#tab-item'",
  "shell.dataset.visualCausalityReady = 'true'",
  "shell.dataset.runtimeReady = 'true'",
  visualVersion
]) assert(runtimeJs.includes(token), `Responsive runtime contract missing: ${token}`);

for (const token of [
  'window.__game',
  'window.GAME_DATA',
  'DATA.ASSETS?.cats',
  'DATA.ASSETS?.enemies',
  'step4/s02/assets/s02-forest-approved.webp',
  'cats-tower:s02-event',
  'formationLanes',
  'enemyLanes',
  "canvas.dataset.partySlotCount = '4'",
  "canvas.dataset.visualCausalityReady = 'true'",
  "canvas.dataset.responsiveStrategy = 'reference-width-reflow-safe-area'",
  "canvas.dataset.rendererReady = 'true'",
  'artworkAspectRatioPreserved: true',
  'minimumReadableTextCssPx: 11',
  'preferredTouchTargetCssPx: 48',
  visualVersion,
  'game.fieldCats',
  'game.enemies'
]) assert(rendererJs.includes(token), `Responsive actual-state renderer missing: ${token}`);

for (const token of [
  '--s02-readable-min: 11px',
  '--s02-control-min: 48px',
  'height: clamp(340px, 50svh, 420px)',
  '.runtime-event-banner,',
  '.runtime-shortcut-rail',
  'display: none !important',
  'position: relative',
  '.runtime-party-dock',
  'font-size: var(--s02-readable-min)',
  '@media (max-width: 359px)',
  '@media (min-height: 780px)',
  '@media (max-height: 720px)',
  'body.runtime-large-text',
  '@media (prefers-reduced-motion: reduce)'
]) assert(runtimeFixes.includes(token), `Responsive CSS contract missing: ${token}`);

assert(!/localStorage|sessionStorage|indexedDB/.test(runtimeJs + rendererJs), 'Visual repair may not create a second persistent state store.');
assert(!/fetch\s*\(/.test(runtimeJs + rendererJs), 'Visual repair may not call a backend in Step 4.');
assert(!/a_full_screen_pixel_art_mobile_game_ui/i.test(rootHtml + runtimeCss + runtimeFixes + runtimeJs + rendererJs), 'Flattened generated screen is forbidden.');
assert(runtimeCss.includes('env(safe-area-inset-top'), 'Safe-area top inset is missing.');
assert(runtimeCss.includes('env(safe-area-inset-bottom'), 'Safe-area bottom inset is missing.');

for (const file of [
  'runtime/s02-runtime.js',
  'runtime/s02-battle-renderer.js',
  'tests/step4/s02-runtime-browser-qa.mjs',
  'tests/governance/verify-current-step2-state.mjs'
]) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failures.push(`${file} syntax failed: ${error.stderr?.toString() || error.message}`);
  }
}

const immutableBlobs = {
  'app.js': '258f8cef77fb37a07d00aaab99ae1e678de764fd',
  'game-core.js': '34471eaa185b2355f17a8e8860261f63ee86bdaf',
  'game-data.js': 'fa01689275f05f1e0879c40586499cc74c337cf9',
  'sw.js': '16aca2f8f94fdfbcf8b228a331e35288fcbc2365',
  'simulation/candidate-v2.json': '1e633de1c6ecb1f98cee262b88575387816cf310',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
  'runtime/s02-runtime.css': '6633698d77511d1e0725545e16aec9c2a18ca49c'
};
for (const [file, expected] of Object.entries(immutableBlobs)) {
  assert(exists(file), `Immutable file missing: ${file}`);
  if (exists(file)) assert(git('hash-object', file) === expected, `Immutable file changed: ${file}`);
}

const repairedBlobs = {
  'runtime/s02-runtime.js': '88ea0bf76bfaf44980bc21cdf8abeaa3b75077f0',
  'runtime/s02-battle-renderer.js': '16e8dfdffaa9beab0723f9be93ad2f467b8d3239',
  'runtime/s02-runtime-fixes.css': '59560b092746b22bf3645ee5f7cbb18f64db07ff',
  'tests/step4/s02-runtime-browser-qa.mjs': 'ef8c1cdef53e3b6002eec16b73e8f74688a08991',
  [responsiveAcceptancePath]: 'a6c3374cc68156dbc382b2302b4396dc42bf2373'
};
for (const [file, expected] of Object.entries(repairedBlobs)) {
  assert(git('hash-object', file) === expected, `Responsive visual-repair blob mismatch: ${file}`);
}

assert(changeControl.status === 'IN_PROGRESS', 'Round 025 must remain IN_PROGRESS before rendered judgment.');
assert(changeControl.verdict === 'IN_PROGRESS_STEP4_S02_ACTUAL_ROOT_VISUAL_REPAIR', 'Round 025 verdict mismatch.');
assert(changeControl.step4Allowed === true, 'Round 025 must allow Step 4 repair.');
assert(changeControl.step5Allowed === false, 'Round 025 may not allow Step 5.');
assert(changeControl.openFinding === 'S4-RECOVERY-VIS-001', 'Round 025 open finding mismatch.');
assert(parentAcceptance.status === 'ACTIVE_BEFORE_VISUAL_REPAIR_WRITE', 'Parent visual repair acceptance status mismatch.');
assert(parentAcceptance.truthfulnessContract?.stateSource === 'window.__game', 'Parent acceptance must bind display to window.__game.');
assert(responsiveAcceptance.status === 'ACTIVE_BEFORE_RESPONSIVE_REPAIR_WRITE', 'Responsive acceptance status mismatch.');
assert(responsiveAcceptance.responsiveStrategy?.id === responsiveStrategy, 'Responsive acceptance strategy mismatch.');
assert(responsiveAcceptance.responsiveStrategy?.minimumReadableTextCssPx === 11, 'Responsive acceptance readable-text minimum mismatch.');
assert(responsiveAcceptance.responsiveStrategy?.preferredTouchTargetCssPx === 48, 'Responsive acceptance touch-target preference mismatch.');
assert(responsiveAcceptance.rejectedApproach?.name === 'uniform-full-screen-scaling', 'Uniform full-screen scaling must be explicitly rejected.');
assert(responsiveAcceptance.completionBoundary?.step5Allowed === false, 'Responsive acceptance may not authorize Step 5.');

for (const token of [
  'PASS_S02_RESPONSIVE_VISUAL_REPAIR_BROWSER',
  'normal-after-explicit-summon',
  '320x568-stress',
  '430x932',
  'touchTargetsUnder48',
  'visibleTextUnderMinimum',
  'followsBattle',
  'adaptiveHeightEvidence',
  'referenceWidthCssPx: 390',
  "physicalIPhone: 'NOT_VERIFIED'"
]) assert(browserQa.includes(token), `Responsive browser QA missing: ${token}`);

for (const token of [
  'runtime/s02-runtime.js',
  'runtime/s02-battle-renderer.js',
  'runtime/s02-runtime-fixes.css',
  'active-change-control-addendum-round-025.json',
  's02-actual-root-visual-repair',
  'PASS_S02_RESPONSIVE_VISUAL_REPAIR_BROWSER'
]) assert(workflow.includes(token), `Workflow responsive trigger/contract missing: ${token}`);

const allowedPaths = [
  /^runtime\/s02-runtime\.js$/,
  /^runtime\/s02-battle-renderer\.js$/,
  /^runtime\/s02-runtime-fixes\.css$/,
  /^tests\/step4\/verify-s02-runtime-integration\.mjs$/,
  /^tests\/step4\/s02-runtime-browser-qa\.mjs$/,
  /^tests\/governance\/verify-current-step2-state\.mjs$/,
  /^\.github\/workflows\/verify-step-4-s02-runtime-integration\.yml$/,
  /^quality-reviews\/step-1-canonical-design\/active-change-control-addendum-round-025\.json$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-actual-root-visual-repair-[^/]+\.json$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-actual-root-visual-repair-browser-evidence\//,
  /^(PROJECT_STATUS\.json|AI_PROJECT_POLICY\.json|QUALITY_GATE\.md|PROJECT_HANDOVER\.md|AGENTS\.md)$/,
  /^simulation\/CURRENT_STATUS\.json$/,
  /^\.github\/workflows\/CURRENT_STATUS\.md$/
];
const changedOutput = git('diff', '--name-only', `${visualRepairEntryHead}..HEAD`);
const changedPaths = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
changedPaths.forEach(file => assert(allowedPaths.some(pattern => pattern.test(file)), `Changed path outside round 025 allow-list: ${file}`));

const forbiddenChanged = changedPaths.filter(file => [
  'app.js', 'game-core.js', 'game-data.js', 'styles.css', 'sw.js', 'vercel.json',
  'simulation/candidate-v2.json', 'simulation/executable-seal-v2.json'
].includes(file) || file.startsWith('backend/') || file.startsWith('payment/') || file.startsWith('ads/'));
assert(forbiddenChanged.length === 0, `Forbidden gameplay/economy/Production paths changed: ${forbiddenChanged.join(', ')}`);

const report = {
  verdict: failures.length ? 'FAIL_S02_RESPONSIVE_VISUAL_REPAIR_STATIC' : 'PASS_S02_RESPONSIVE_VISUAL_REPAIR_STATIC',
  repository,
  branch,
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  route: '/',
  source: 'window.__game',
  visualVersion,
  responsiveStrategy,
  referenceWidthCssPx: 390,
  minimumReadableTextCssPx: 11,
  preferredTouchTargetCssPx: 48,
  changedPaths,
  forbiddenChanged,
  repairedBlobs,
  immutableBlobs,
  unresolvedFinding: 'S4-RECOVERY-VIS-001',
  step4Pass: false,
  step5Allowed: false,
  productionChanged: false,
  physicalIPhone: 'NOT_VERIFIED',
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
