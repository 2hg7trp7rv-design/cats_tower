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
  'legacy.html',
  'step4/s02/index.html',
  'step4/s02/styles.css',
  'step4/s02/refinement.css',
  'step4/s02/production.css',
  'step4/s02/art-round004.css',
  'step4/s02/app.js',
  'step4/s02/root-entry.js',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-implementation-acceptance-round-001.json',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-runtime-integration-acceptance-round-001.json',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-022.json'
];
for (const file of requiredFiles) assert(exists(file), `Missing: ${file}`);

const rootHtml = read('index.html');
const legacyHtml = read('legacy.html');
const s02Html = read('step4/s02/index.html');
const baseCss = read('step4/s02/styles.css');
const refinementCss = read('step4/s02/refinement.css');
const productionCss = read('step4/s02/production.css');
const appJs = read('step4/s02/app.js');
const rootEntryJs = read('step4/s02/root-entry.js');

for (const token of [
  'id="game-root"',
  '/step4/s02/styles.css',
  '/step4/s02/refinement.css',
  '/step4/s02/production.css',
  '/step4/s02/root-entry.js',
  'data-main-entry-ready="pending"'
]) assert(rootHtml.includes(token), `Root entry contract missing: ${token}`);

assert(!/<(?:iframe|object|embed)\b/i.test(rootHtml), 'Root entry must not embed a document.');
assert(!/http-equiv=["']refresh/i.test(rootHtml), 'Root entry must not use meta refresh.');
assert(!/location\.(?:assign|replace)|location\s*=/i.test(rootHtml + rootEntryJs), 'Root entry must not redirect by location.');
assert(!/a_full_screen_pixel_art_mobile_game_ui/i.test(rootHtml + baseCss + refinementCss + productionCss + appJs + rootEntryJs), 'Flattened approved screenshot is forbidden.');

for (const token of [
  "const ROOT_SOURCE = '/step4/s02/index.html'",
  'fetch(ROOT_SOURCE',
  'new DOMParser()',
  'document.importNode(sourceShell, true)',
  "shell.dataset.runtimeEntry = 'main'",
  "document.documentElement.dataset.mainEntryReady = 'true'",
  "const LEGACY_SOURCE = '/legacy.html'"
]) assert(rootEntryJs.includes(token), `Root composition contract missing: ${token}`);

for (const token of [
  '<!doctype html>',
  'lang="ja"',
  'viewport-fit=cover',
  'data-testid="s02-shell"',
  'class="player-bar',
  'class="context-bar',
  'class="battle-stage',
  'class="shortcut-rail"',
  'class="skill-row',
  'class="party-roster',
  'id="support-button"',
  'class="bottom-nav',
  'href="./production.css"'
]) assert(s02Html.includes(token), `S02 source contract missing: ${token}`);

assert((s02Html.match(/class="nav-button/g) || []).length === 5, 'Five bottom tabs are required.');
assert((s02Html.match(/class="battle-unit ally/g) || []).length === 4, 'Four active allies are required.');
assert((s02Html.match(/class="battle-unit enemy/g) || []).length === 3, 'Three visible enemies are required.');
assert((s02Html.match(/class="skill-button/g) || []).length === 6, 'Six skill controls are required.');
assert(!/\son[a-z]+\s*=/i.test(s02Html), 'Inline event handlers are forbidden.');
assert(!/<iframe\b/i.test(s02Html), 'S02 source iframe is forbidden.');
assert(!/https?:\/\//i.test(s02Html), 'External runtime URLs are forbidden.');

const buttons = [...s02Html.matchAll(/<button\b[^>]*>/gi)].map((match) => match[0]);
assert(buttons.length >= 25, 'Expected production-density control set is incomplete.');
buttons.forEach((tag, index) => assert(/class="[^"]*\btap-target\b/.test(tag), `Button ${index + 1} lacks tap-target.`));

const images = [...s02Html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
images.forEach((tag, index) => assert(/\balt="[^"]*"/.test(tag), `Image ${index + 1} lacks alt.`));

for (const token of [
  'env(safe-area-inset-top',
  'env(safe-area-inset-bottom',
  'min-width: 44px',
  'min-height: 44px',
  '@media (prefers-reduced-motion: reduce)'
]) assert((baseCss + refinementCss + productionCss).includes(token), `CSS contract missing: ${token}`);

for (const token of [
  '@import url("./art-round004.css")',
  './assets/s02-forest-approved.webp',
  '/assets/prototype/bg/floor_living.png',
  '/assets/prototype/cats/mugi.png',
  '/assets/prototype/enemies/blackwing_guard.png',
  '/assets/prototype/shops/claw_forge.png'
]) assert(productionCss.includes(token), `Production visual contract missing: ${token}`);

for (const relative of [
  'assets/prototype/bg/floor_living.png',
  'assets/prototype/cats/mugi.png',
  'assets/prototype/cats/luna.png',
  'assets/prototype/cats/kohaku.png',
  'assets/prototype/cats/slinger.png',
  'assets/prototype/cats/toto.png',
  'assets/prototype/enemies/ash_mouse.png',
  'assets/prototype/enemies/sack_mole.png',
  'assets/prototype/enemies/blackwing_guard.png',
  'assets/prototype/shops/fish_diner.png',
  'assets/prototype/shops/clinic.png',
  'assets/prototype/shops/claw_forge.png'
]) assert(exists(relative), `Production visual asset missing: ${relative}`);

for (const token of [
  "'use strict'",
  "matchMedia('(prefers-reduced-motion: reduce)')",
  'setAuto(',
  'setSpeed(',
  'activateSkill(',
  'activateSupport(',
  "root.dataset.ready = 'true'"
]) assert(appJs.includes(token), `S02 application contract missing: ${token}`);
assert(!/fetch\s*\(/.test(appJs), 'S02 app must not call backend in Step 4.');
assert(!/localStorage|sessionStorage|indexedDB/.test(appJs), 'Persistent state is forbidden in Step 4.');

try { execFileSync(process.execPath, ['--check', path.join(root, 'step4/s02/app.js')], { stdio: 'pipe' }); }
catch (error) { failures.push(`S02 JavaScript syntax failed: ${error.stderr?.toString() || error.message}`); }
try { execFileSync(process.execPath, ['--check', path.join(root, 'step4/s02/root-entry.js')], { stdio: 'pipe' }); }
catch (error) { failures.push(`Root-entry JavaScript syntax failed: ${error.stderr?.toString() || error.message}`); }

assert(legacyHtml.includes('id="battle"'), 'Legacy Canvas battle entry was not preserved.');
assert(legacyHtml.includes('id="tower-list"'), 'Legacy tower list was not preserved.');
assert(git('hash-object', 'legacy.html') === 'c5871ded0f7fbb501dce08e2b0da767841ce789b', 'Legacy root blob differs from the pre-integration entry.');

const protectedBlobs = {
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
  assert(exists(file), `Protected file missing: ${file}`);
  if (exists(file)) assert(git('hash-object', file) === expected, `Protected file changed: ${file}`);
}

const report = {
  verdict: failures.length ? 'FAIL_S02_STATIC_CONTRACT_V3' : 'PASS_S02_STATIC_CONTRACT_V3',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  rootEntry: '/',
  isolatedEntry: '/step4/s02/',
  legacyEntry: '/legacy.html',
  controls: buttons.length,
  images: images.length,
  preservedLegacyBlob: exists('legacy.html') ? git('hash-object', 'legacy.html') : null,
  protectedBlobs,
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
