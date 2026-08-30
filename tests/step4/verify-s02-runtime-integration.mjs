import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const recoveryEntryHead = '3ccff631e9e9174a69ec4e5e904c4dfbc552dbe9';
const requiredFiles = [
  'index.html',
  'step4/s02/index.html',
  'app.js',
  'game-core.js',
  'game-data.js',
  'sw.js',
  'runtime/s02-runtime.css',
  'runtime/s02-runtime-fixes.css',
  'runtime/s02-runtime.js',
  'runtime/s02-battle-renderer.js',
  'tests/step4/s02-runtime-browser-qa.mjs',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-023.json',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-governance-recovery-acceptance.json'
];
for (const file of requiredFiles) assert(exists(file), `Missing recovery file: ${file}`);

const rootHtml = read('index.html');
const isolatedHtml = read('step4/s02/index.html');
const runtimeCss = read('runtime/s02-runtime.css');
const runtimeFixes = read('runtime/s02-runtime-fixes.css');
const runtimeJs = read('runtime/s02-runtime.js');
const rendererJs = read('runtime/s02-battle-renderer.js');

function viewportContent(html) {
  const tag = html.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i)?.[0]
    || html.match(/<meta\b[^>]*\bcontent=["'][^"']*["'][^>]*\bname=["']viewport["'][^>]*>/i)?.[0]
    || '';
  return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] || '';
}

for (const [label, html] of [['root', rootHtml], ['isolated S02', isolatedHtml]]) {
  const viewport = viewportContent(html);
  assert(viewport.includes('width=device-width'), `${label}: viewport width contract is missing.`);
  assert(viewport.includes('viewport-fit=cover'), `${label}: safe-area viewport-fit contract is missing.`);
  assert(!/user-scalable\s*=\s*no/i.test(viewport), `${label}: user zoom is disabled.`);
  const maximum = viewport.match(/maximum-scale\s*=\s*([0-9.]+)/i);
  if (maximum) assert(Number(maximum[1]) >= 2, `${label}: maximum-scale below 2 blocks sufficient zoom.`);
}

for (const token of [
  'data-testid="s02-runtime-shell"',
  'runtime/s02-runtime.css',
  'runtime/s02-runtime-fixes.css',
  'runtime/s02-runtime.js',
  'id="battle"',
  'id="btn-summon"',
  'id="tower-list"',
  'id="btn-dawn"',
  'class="runtime-bottom-nav"',
  'data-runtime-action="agency"',
  'data-runtime-action="forge"',
  'data-runtime-action="item"',
  'data-runtime-action="shops"',
  'data-runtime-action="return"'
]) assert(rootHtml.includes(token), `Root integration missing: ${token}`);

assert((rootHtml.match(/class="runtime-nav-button/g) || []).length === 5, 'Root must expose exactly five bottom navigation buttons.');
assert(!/<(?:iframe|object|embed)\b/i.test(rootHtml + isolatedHtml), 'Embedded-document integration is forbidden.');
assert(!/\son[a-z]+\s*=/i.test(rootHtml + isolatedHtml), 'Inline event handlers are forbidden.');
assert(!/a_full_screen_pixel_art_mobile_game_ui/i.test(rootHtml + isolatedHtml + runtimeCss + runtimeFixes + runtimeJs + rendererJs), 'Flattened generated screen is forbidden.');

for (const token of [
  'window.__game',
  'mountActualStateRenderer',
  'runtime/s02-battle-renderer.js',
  "clickExisting('#tab-agency'",
  "clickExisting('#tab-forge'",
  "clickExisting('#tab-item'",
  "shell.dataset.runtimeReady = 'true'"
]) assert(runtimeJs.includes(token), `Runtime state bridge missing: ${token}`);

for (const token of [
  'window.__game',
  'window.GAME_DATA',
  'DATA.ASSETS.cats',
  'DATA.ASSETS.enemies',
  'step4/s02/assets/s02-forest-approved.webp',
  "canvas.dataset.rendererReady = 'true'",
  'game.fieldCats',
  'game.enemies'
]) assert(rendererJs.includes(token), `Actual-state renderer missing: ${token}`);

assert(!/localStorage|sessionStorage|indexedDB/.test(runtimeJs + rendererJs), 'S02 bridge may not create a second persistent state store.');
assert(!/fetch\s*\(/.test(runtimeJs + rendererJs), 'S02 bridge may not call a backend in Step 4.');
assert(runtimeCss.includes('env(safe-area-inset-top'), 'Safe-area top inset is missing.');
assert(runtimeCss.includes('env(safe-area-inset-bottom'), 'Safe-area bottom inset is missing.');
assert(runtimeCss.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion CSS is missing.');
assert(runtimeCss.includes('body.runtime-large-text'), 'Large-text simulation styling is missing.');
assert(runtimeFixes.includes('.sheet') && runtimeFixes.includes('z-index: 82'), 'Sheet/navigation stacking repair is missing.');

for (const file of ['runtime/s02-runtime.js', 'runtime/s02-battle-renderer.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failures.push(`${file} syntax failed: ${error.stderr?.toString() || error.message}`);
  }
}

const immutableBlobs = {
  'game-core.js': '34471eaa185b2355f17a8e8860261f63ee86bdaf',
  'game-data.js': 'fa01689275f05f1e0879c40586499cc74c337cf9',
  'sw.js': '2d21ce6930746722910e6182a7310da6f1245fb7',
  'simulation/candidate-v2.json': '1e633de1c6ecb1f98cee262b88575387816cf310',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
  'runtime/s02-runtime.css': '6633698d77511d1e0725545e16aec9c2a18ca49c',
  'runtime/s02-runtime-fixes.css': 'fcbbeba2d8541691dbdd11c96c7c8817b1e6842b',
  'runtime/s02-runtime.js': 'fb03de942075ec05bcab476234205288688d639d',
  'runtime/s02-battle-renderer.js': 'de2f6fbfe1f316d6bc15081088bab6b0179344ff'
};
for (const [file, expected] of Object.entries(immutableBlobs)) {
  assert(exists(file), `Immutable file missing: ${file}`);
  if (exists(file)) assert(git('hash-object', file) === expected, `Immutable recovery-bound file changed: ${file}`);
}

const allowedRecoveryPaths = [
  /^index\.html$/,
  /^step4\/s02\/index\.html$/,
  /^tests\/step4\/verify-s02-runtime-integration\.mjs$/,
  /^tests\/step4\/s02-runtime-browser-qa\.mjs$/,
  /^\.github\/workflows\/verify-step-4-s02-runtime-integration\.yml$/,
  /^\.github\/workflows\/execute-step-4-s02-main-entry-v2\.yml$/,
  /^\.github\/workflows\/verify-step-4-s02-terminal-readback-v2\.yml$/,
  /^quality-reviews\/step-1-canonical-design\/active-change-control-addendum-round-023\.json$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-main-entry-governance-recovery-[^/]+\.json$/,
  /^(PROJECT_STATUS\.json|AI_PROJECT_POLICY\.json|QUALITY_GATE\.md|PROJECT_HANDOVER\.md|AGENTS\.md)$/,
  /^simulation\/CURRENT_STATUS\.json$/,
  /^\.github\/workflows\/CURRENT_STATUS\.md$/
];
const changedPaths = git('diff', '--name-only', `${recoveryEntryHead}..HEAD`).split('\n').filter(Boolean);
changedPaths.forEach(file => assert(allowedRecoveryPaths.some(pattern => pattern.test(file)), `Out-of-bound recovery change: ${file}`));

try {
  execFileSync('git', ['diff', '--check', `${recoveryEntryHead}..HEAD`], { cwd: root, stdio: 'pipe' });
} catch (error) {
  failures.push(`git diff --check failed: ${error.stderr?.toString() || error.message}`);
}

const report = {
  verdict: failures.length ? 'FAIL_S02_MAIN_ENTRY_RECOVERY_STATIC' : 'PASS_S02_MAIN_ENTRY_RECOVERY_STATIC',
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  recoveryEntryHead,
  step4Pass: false,
  step5Allowed: false,
  viewportAccessibility: {
    root: viewportContent(rootHtml),
    isolatedS02: viewportContent(isolatedHtml)
  },
  changedPaths,
  immutableBlobs,
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
