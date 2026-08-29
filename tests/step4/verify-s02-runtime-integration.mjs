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

const requiredFiles = [
  'index.html',
  'app.js',
  'game-core.js',
  'game-data.js',
  'sw.js',
  'runtime/s02-runtime.css',
  'runtime/s02-runtime.js',
  'runtime/s02-battle-renderer.js',
  'step4/s02/assets/s02-forest-approved.webp',
  'step4/s02/assets/s02-ui-icons.svg',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-runtime-integration-acceptance-round-001.json',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-020.json'
];
for (const file of requiredFiles) assert(exists(file), `Missing required runtime integration file: ${file}`);

const html = read('index.html');
const css = read('runtime/s02-runtime.css');
const runtime = read('runtime/s02-runtime.js');
const renderer = read('runtime/s02-battle-renderer.js');
const sw = read('sw.js');

for (const token of [
  'data-testid="s02-runtime-shell"',
  'runtime/s02-runtime.css',
  'runtime/s02-runtime.js',
  'id="battle"',
  'id="btn-summon"',
  'id="tower-list"',
  'id="btn-dawn"',
  'id="btn-shop-pending"',
  'class="runtime-bottom-nav"',
  'data-runtime-action="agency"',
  'data-runtime-action="forge"',
  'data-runtime-action="item"',
  'data-runtime-action="shops"',
  'data-runtime-action="return"'
]) assert(html.includes(token), `Root game entry is missing: ${token}`);

assert((html.match(/class="runtime-nav-button/g) || []).length === 5, 'Root game must expose five bottom navigation buttons.');
assert(!/<iframe\b/i.test(html), 'Iframe integration is forbidden.');
assert(!/a_full_screen_pixel_art_mobile_game_ui/i.test(html + css + runtime + renderer), 'Flattened generated game-screen image is forbidden.');
assert(!/\son[a-z]+\s*=/i.test(html), 'Inline event handlers are forbidden.');

for (const token of [
  'window.__game',
  'mountActualStateRenderer',
  "runtime/s02-battle-renderer.js",
  "clickExisting('#tab-agency'",
  "clickExisting('#tab-forge'",
  "clickExisting('#tab-item'",
  "shell.dataset.runtimeReady = 'true'"
]) assert(runtime.includes(token), `Runtime state bridge is missing: ${token}`);

for (const token of [
  'window.__game',
  'window.GAME_DATA',
  'DATA.ASSETS.cats',
  'DATA.ASSETS.enemies',
  'step4/s02/assets/s02-forest-approved.webp',
  "canvas.dataset.rendererReady = 'true'",
  'game.fieldCats',
  'game.enemies'
]) assert(renderer.includes(token), `Actual-state renderer is missing: ${token}`);

assert(!/localStorage|sessionStorage|indexedDB/.test(runtime + renderer), 'The S02 bridge may not create a second persistent state store.');
assert(!/fetch\s*\(/.test(runtime + renderer), 'The S02 bridge may not call a backend in Step 4.');
assert(css.includes("url('../step4/s02/assets/s02-ui-icons.svg')"), 'Controlled S02 icon sheet is not used by the root shell.');
assert(css.includes('env(safe-area-inset-top'), 'Safe-area top inset is missing.');
assert(css.includes('env(safe-area-inset-bottom'), 'Safe-area bottom inset is missing.');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion CSS is missing.');
assert(css.includes('body.runtime-large-text'), 'Large-text simulation styling is missing.');

for (const token of [
  "'runtime/s02-runtime.css'",
  "'runtime/s02-runtime.js'",
  "'runtime/s02-battle-renderer.js'",
  "'step4/s02/assets/s02-forest-approved.webp'",
  "'step4/s02/assets/s02-ui-icons.svg'"
]) assert(sw.includes(token), `Service worker shell is missing: ${token}`);

for (const file of ['runtime/s02-runtime.js', 'runtime/s02-battle-renderer.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failures.push(`${file} syntax failed: ${error.stderr?.toString() || error.message}`);
  }
}

const protectedBlobs = {
  'game-core.js': '34471eaa185b2355f17a8e8860261f63ee86bdaf',
  'game-data.js': 'fa01689275f05f1e0879c40586499cc74c337cf9',
  'simulation/candidate-v2.json': '1e633de1c6ecb1f98cee262b88575387816cf310',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1'
};
for (const [file, expected] of Object.entries(protectedBlobs)) {
  assert(exists(file), `Protected file missing: ${file}`);
  if (exists(file)) assert(git('hash-object', file) === expected, `Protected file changed: ${file}`);
}

const entryHead = '4e5cc9923c7db37e21001407f3bcd8a77fb48504';
const allowed = [
  /^index\.html$/,
  /^sw\.js$/,
  /^runtime\/s02-(runtime|battle-renderer)\.(css|js)$/,
  /^tests\/step4\/(verify-s02-runtime-integration|s02-runtime-browser-qa)\.mjs$/,
  /^\.github\/workflows\/(verify|apply)-step-4-s02-runtime-integration\.yml$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-runtime-integration-[^/]+\.json$/,
  /^quality-reviews\/step-1-canonical-design\/active-change-control(?:-addendum-round-020)?\.json$/,
  /^(PROJECT_STATUS\.json|AI_PROJECT_POLICY\.json|QUALITY_GATE\.md|PROJECT_HANDOVER\.md|AGENTS\.md)$/,
  /^simulation\/CURRENT_STATUS\.json$/,
  /^\.github\/workflows\/CURRENT_STATUS\.md$/
];
const changed = git('diff', '--name-only', `${entryHead}..HEAD`).split('\n').filter(Boolean);
changed.forEach(file => assert(allowed.some(pattern => pattern.test(file)), `Out-of-bound runtime integration change: ${file}`));

try {
  execFileSync('git', ['diff', '--check', `${entryHead}..HEAD`], { cwd: root, stdio: 'pipe' });
} catch (error) {
  failures.push(`git diff --check failed: ${error.stderr?.toString() || error.message}`);
}

const report = {
  verdict: failures.length ? 'FAIL_S02_RUNTIME_STATIC_INTEGRATION' : 'PASS_S02_RUNTIME_STATIC_INTEGRATION',
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  entryHead,
  actualEntryPoint: '/',
  sourceOfTruth: 'window.__game',
  changedPaths: changed,
  protectedBlobs,
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
