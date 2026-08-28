import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const entryHead = 'd8c6b110604596265124ad277da430d38a6cd09e';
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const requiredFiles = [
  'step4/s02/index.html',
  'step4/s02/styles.css',
  'step4/s02/app.js',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-implementation-acceptance-round-001.json',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-019.json'
];
for (const file of requiredFiles) assert(fs.existsSync(path.join(root, file)), `Missing: ${file}`);

const html = read('step4/s02/index.html');
const css = read('step4/s02/styles.css');
const js = read('step4/s02/app.js');

const requiredHtml = [
  '<!doctype html>', 'lang="ja"', 'viewport-fit=cover', 'data-testid="s02-shell"',
  'class="player-bar', 'class="context-bar', 'class="battle-stage', 'class="shortcut-rail"',
  'class="skill-row', 'class="party-roster', 'id="support-button"', 'class="bottom-nav'
];
for (const token of requiredHtml) assert(html.includes(token), `HTML contract missing: ${token}`);

assert((html.match(/class="nav-button/g) || []).length === 5, 'Five bottom tabs are required.');
assert((html.match(/class="battle-unit ally/g) || []).length === 4, 'Four active allies are required.');
assert((html.match(/class="battle-unit enemy/g) || []).length === 3, 'Three visible enemies are required.');
assert((html.match(/class="skill-button/g) || []).length === 6, 'Six skill controls are required.');
assert(!/\son[a-z]+\s*=/i.test(html), 'Inline event handlers are forbidden.');
assert(!/<iframe\b/i.test(html), 'Iframes are forbidden.');
assert(!/https?:\/\//i.test(html), 'External runtime URLs are forbidden.');

const buttons = [...html.matchAll(/<button\b[^>]*>/gi)].map((match) => match[0]);
assert(buttons.length >= 25, 'Expected production-density control set is incomplete.');
buttons.forEach((tag, index) => assert(/class="[^"]*\btap-target\b/.test(tag), `Button ${index + 1} lacks tap-target.`));

const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
images.forEach((tag, index) => assert(/\balt="[^"]*"/.test(tag), `Image ${index + 1} lacks alt.`));

const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
assets.forEach((asset) => assert(fs.existsSync(path.join(root, asset.slice(1))), `Missing asset: ${asset}`));

for (const token of [
  'env(safe-area-inset-top', 'env(safe-area-inset-bottom', 'min-width: 44px',
  'min-height: 44px', '@media (prefers-reduced-motion: reduce)',
  '@media (max-width: 359px)', '@media (min-width: 400px)', '/assets/saga/bg_corridor.webp'
]) assert(css.includes(token), `CSS contract missing: ${token}`);
assert(!/data:image\//i.test(css), 'Embedded raster data is forbidden.');
assert(!/a_full_screen_pixel_art_mobile_game_ui/i.test(html + css + js), 'Flattened approved screenshot is forbidden.');

for (const token of [
  "'use strict'", "matchMedia('(prefers-reduced-motion: reduce)')", 'setAuto(', 'setSpeed(',
  'activateSkill(', 'activateSupport(', "root.dataset.ready = 'true'"
]) assert(js.includes(token), `JavaScript contract missing: ${token}`);
assert(!/fetch\s*\(/.test(js), 'Backend calls are forbidden in Step 4 prototype.');
assert(!/localStorage|sessionStorage|indexedDB/.test(js), 'Persistent state is forbidden in Step 4 prototype.');

try { execFileSync(process.execPath, ['--check', path.join(root, 'step4/s02/app.js')], { stdio: 'pipe' }); }
catch (error) { failures.push(`JavaScript syntax failed: ${error.stderr?.toString() || error.message}`); }

const protectedBlobs = {
  'index.html': 'c5871ded0f7fbb501dce08e2b0da767841ce789b',
  'app.js': '258f8cef77fb37a07d00aaab99ae1e678de764fd',
  'styles.css': 'ed222e53204411297eac3f9556bb7e91b9470597',
  'game-core.js': '34471eaa185b2355f17a8e8860261f63ee86bdaf',
  'game-data.js': 'fa01689275f05f1e0879c40586499cc74c337cf9',
  'sw.js': '2d21ce6930746722910e6182a7310da6f1245fb7',
  'manifest.webmanifest': '140c74f6119d1043071fa1aad31e6045af174943',
  'simulation/candidate-v2.json': '1e633de1c6ecb1f98cee262b88575387816cf310',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1'
};
for (const [file, expected] of Object.entries(protectedBlobs)) {
  assert(fs.existsSync(path.join(root, file)), `Protected file missing: ${file}`);
  if (fs.existsSync(path.join(root, file))) assert(git('hash-object', file) === expected, `Protected file changed: ${file}`);
}

const allowed = [
  /^step4\/s02\//,
  /^tests\/step4\/s02-[^/]+\.mjs$/,
  /^\.github\/workflows\/verify-step-4-s02-anchor\.yml$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-[^/]+$/,
  /^quality-reviews\/step-1-canonical-design\/active-change-control-addendum-round-019\.json$/,
  /^(PROJECT_STATUS\.json|AI_PROJECT_POLICY\.json|QUALITY_GATE\.md|PROJECT_HANDOVER\.md|AGENTS\.md)$/,
  /^\.github\/workflows\/CURRENT_STATUS\.md$/
];
const changed = git('diff', '--name-only', `${entryHead}..HEAD`).split('\n').filter(Boolean);
changed.forEach((file) => assert(allowed.some((pattern) => pattern.test(file)), `Out-of-bound change: ${file}`));
try { execFileSync('git', ['diff', '--check', `${entryHead}..HEAD`], { cwd: root, stdio: 'pipe' }); }
catch (error) { failures.push(`git diff --check failed: ${error.stderr?.toString() || error.message}`); }

const report = {
  verdict: failures.length ? 'FAIL_S02_STATIC_CONTRACT_V2' : 'PASS_S02_STATIC_CONTRACT_V2',
  entryHead,
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  controls: buttons.length,
  images: images.length,
  assetReferences: assets.length,
  changedPaths: changed,
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
