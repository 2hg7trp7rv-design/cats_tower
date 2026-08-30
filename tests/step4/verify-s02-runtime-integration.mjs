import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));
const exists = (relative) => fs.existsSync(path.join(root, relative));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const repository = '2hg7trp7rv-design/cats_tower';
const branch = 'kimi';
const visualRepairEntryHead = '9495c97232213620346958f271913fd8a585ff50';
const changeControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-025.json';
const acceptancePath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-actual-root-visual-repair-acceptance-round-001.json';
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
  acceptancePath
];
for (const file of requiredFiles) assert(exists(file), `Missing visual-repair file: ${file}`);

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
const acceptance = readJson(acceptancePath);

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
  'partySlots: 4',
  "clickExisting('#tab-agency'",
  "clickExisting('#tab-forge'",
  "clickExisting('#tab-item'",
  "shell.dataset.visualCausalityReady = 'true'",
  "shell.dataset.runtimeReady = 'true'"
]) assert(runtimeJs.includes(token), `Visual runtime contract missing: ${token}`);

for (const token of [
  'window.__game',
  'window.GAME_DATA',
  'DATA.ASSETS?.cats',
  'DATA.ASSETS?.enemies',
  'step4/s02/assets/s02-forest-approved.webp',
  'cats-tower:s02-event',
  "canvas.dataset.partySlotCount = '4'",
  "canvas.dataset.visualCausalityReady = 'true'",
  "canvas.dataset.rendererReady = 'true'",
  's02-visual-repair-round-001',
  'game.fieldCats',
  'game.enemies'
]) assert(rendererJs.includes(token), `Actual-state visual renderer missing: ${token}`);

assert(!/localStorage|sessionStorage|indexedDB/.test(runtimeJs + rendererJs), 'Visual repair may not create a second persistent state store.');
assert(!/fetch\s*\(/.test(runtimeJs + rendererJs), 'Visual repair may not call a backend in Step 4.');
assert(!/a_full_screen_pixel_art_mobile_game_ui/i.test(rootHtml + runtimeCss + runtimeFixes + runtimeJs + rendererJs), 'Flattened generated screen is forbidden.');
assert(runtimeCss.includes('env(safe-area-inset-top'), 'Safe-area top inset is missing.');
assert(runtimeCss.includes('env(safe-area-inset-bottom'), 'Safe-area bottom inset is missing.');
assert(runtimeFixes.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion repair CSS is missing.');
assert(runtimeFixes.includes('body.runtime-large-text'), 'Large-text repair styling is missing.');
assert(runtimeFixes.includes('.runtime-party-dock'), 'Four-slot party presentation styling is missing.');
assert(runtimeFixes.includes('.runtime-causality-strip'), 'Combat causality styling is missing.');
assert(runtimeFixes.includes('#runtime-battle-canvas'), 'Actual-state renderer styling is missing.');

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
  'runtime/s02-runtime.js': '2d9560981b285b84f43f466729431c9e827380ee',
  'runtime/s02-battle-renderer.js': '56b5850b7092e75c9090e51161466418a9abf813',
  'runtime/s02-runtime-fixes.css': '4ea83015756fd3fa1aa38e32ec779ed442ac9264'
};
for (const [file, expected] of Object.entries(repairedBlobs)) {
  assert(git('hash-object', file) === expected, `Visual-repair blob mismatch: ${file}`);
}

assert(changeControl.status === 'IN_PROGRESS', 'Round 025 must remain IN_PROGRESS before rendered judgment.');
assert(changeControl.verdict === 'IN_PROGRESS_STEP4_S02_ACTUAL_ROOT_VISUAL_REPAIR', 'Round 025 verdict mismatch.');
assert(changeControl.step4Allowed === true, 'Round 025 must allow Step 4 repair.');
assert(changeControl.step5Allowed === false, 'Round 025 may not allow Step 5.');
assert(changeControl.openFinding === 'S4-RECOVERY-VIS-001', 'Round 025 open finding mismatch.');
assert(acceptance.status === 'ACTIVE_BEFORE_VISUAL_REPAIR_WRITE', 'Visual repair acceptance status mismatch.');
assert(acceptance.truthfulnessContract?.stateSource === 'window.__game', 'Acceptance must bind display to window.__game.');
assert(acceptance.completionBoundary?.step5Allowed === false, 'Acceptance may not authorize Step 5.');

for (const token of [
  'PASS_S02_ACTUAL_ROOT_VISUAL_REPAIR_BROWSER',
  'normal-after-explicit-summon',
  'partySlotCount',
  'visualCausalityReady',
  'resource value clipping',
  "physicalIPhone: 'NOT_VERIFIED'"
]) assert(browserQa.includes(token), `Browser visual-repair QA missing: ${token}`);

for (const token of [
  'runtime/s02-runtime.js',
  'runtime/s02-battle-renderer.js',
  'runtime/s02-runtime-fixes.css',
  'active-change-control-addendum-round-025.json',
  's02-actual-root-visual-repair',
  'PASS_S02_ACTUAL_ROOT_VISUAL_REPAIR_BROWSER'
]) assert(workflow.includes(token), `Workflow visual-repair trigger/contract missing: ${token}`);

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
changedPaths.forEach(file => assert(allowedPaths.some(pattern => pattern.test(file)), `Out-of-bound visual-repair change: ${file}`));
assert(changedPaths.some(file => file === 'runtime/s02-runtime.js'), 'Visual repair did not update runtime/s02-runtime.js.');
assert(changedPaths.some(file => file === 'runtime/s02-battle-renderer.js'), 'Visual repair did not update runtime/s02-battle-renderer.js.');
assert(changedPaths.some(file => file === 'runtime/s02-runtime-fixes.css'), 'Visual repair did not update runtime/s02-runtime-fixes.css.');

try {
  execFileSync('git', ['diff', '--check', `${visualRepairEntryHead}..HEAD`], { cwd: root, stdio: 'pipe' });
} catch (error) {
  failures.push(`git diff --check failed: ${error.stderr?.toString() || error.message}`);
}

const report = {
  verdict: failures.length ? 'FAIL_S02_ACTUAL_ROOT_VISUAL_REPAIR_STATIC' : 'PASS_S02_ACTUAL_ROOT_VISUAL_REPAIR_STATIC',
  repository,
  branch,
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  visualRepairEntryHead,
  source: 'window.__game',
  eventSource: 'non-consuming window.__game.emit observation',
  partySlots: 4,
  visualCausality: true,
  immutableBlobs,
  repairedBlobs,
  changedPaths,
  step4Pass: false,
  step5Allowed: false,
  productionChanged: false,
  physicalIPhone: 'NOT_VERIFIED',
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
