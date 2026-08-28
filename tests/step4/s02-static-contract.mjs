import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const entryHead = 'd8c6b110604596265124ad277da430d38a6cd09e';
const routeDir = path.join(root, 'step4', 's02');
const htmlPath = path.join(routeDir, 'index.html');
const cssPath = path.join(routeDir, 'styles.css');
const jsPath = path.join(routeDir, 'app.js');
const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function read(file) {
  assert(fs.existsSync(file), `Missing required file: ${path.relative(root, file)}`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const html = read(htmlPath);
const css = read(cssPath);
const js = read(jsPath);

assert(html.startsWith('<!doctype html>'), 'S02 HTML must start with a standards-mode doctype.');
assert(html.includes('lang="ja"'), 'S02 HTML must declare Japanese language.');
assert(html.includes('viewport-fit=cover'), 'S02 HTML must opt into safe-area-aware viewport rendering.');
assert(html.includes('data-testid="s02-shell"'), 'S02 shell test anchor is missing.');
assert(html.includes('<header class="player-bar'), 'Persistent player/resource header is missing.');
assert(html.includes('<section class="context-bar'), 'Contextual floor/status strip is missing.');
assert(html.includes('<section class="battle-stage'), 'Scene-led battle field is missing.');
assert(html.includes('class="shortcut-rail"'), 'Right shortcut rail is missing.');
assert(html.includes('class="skill-row'), 'Skill row is missing.');
assert(html.includes('class="party-roster'), 'Party roster is missing.');
assert(html.includes('id="support-button"'), 'Merchant-support activation is missing.');
assert(html.includes('<nav class="bottom-nav'), 'Persistent five-tab bottom navigation is missing.');
assert((html.match(/class="nav-button/g) || []).length === 5, 'Bottom navigation must contain exactly five primary tabs.');
assert((html.match(/class="battle-unit ally/g) || []).length === 4, 'Battle field must contain exactly four active ally units.');
assert((html.match(/class="battle-unit enemy/g) || []).length === 3, 'Battle field must contain exactly three visible enemy units.');
assert((html.match(/class="skill-button/g) || []).length === 6, 'S02 must expose six visible skill controls.');
assert(!/\son[a-z]+\s*=/i.test(html), 'Inline event-handler attributes are forbidden.');
assert(!/<iframe\b/i.test(html), 'Embedded external pages are forbidden.');
assert(!/https?:\/\//i.test(html), 'S02 route must not load external runtime dependencies.');

const buttonOpenTags = [...html.matchAll(/<button\b[^>]*>/gi)].map((match) => match[0]);
assert(buttonOpenTags.length >= 25, 'Expected production-density button set is incomplete.');
for (const [index, tag] of buttonOpenTags.entries()) {
  assert(/class="[^"]*\btap-target\b/.test(tag), `Button ${index + 1} lacks the shared tap-target contract.`);
}

const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
for (const [index, tag] of imgTags.entries()) {
  assert(/\balt="[^"]*"/.test(tag), `Image ${index + 1} lacks an alt attribute.`);
}

const assetRefs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
for (const assetRef of assetRefs) {
  const localPath = path.join(root, assetRef.replace(/^\//, ''));
  assert(fs.existsSync(localPath), `Referenced asset does not exist: ${assetRef}`);
}

assert(css.includes('env(safe-area-inset-top'), 'Top safe-area inset support is missing.');
assert(css.includes('env(safe-area-inset-bottom'), 'Bottom safe-area inset support is missing.');
assert(css.includes('min-width: 44px'), 'Shared minimum 44px target width is missing.');
assert(css.includes('min-height: 44px'), 'Shared minimum 44px target height is missing.');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion stylesheet contract is missing.');
assert(css.includes('@media (max-width: 359px)'), 'Small-viewport adaptation is missing.');
assert(css.includes('@media (min-width: 400px)'), 'Large portrait adaptation is missing.');
assert(css.includes('/assets/saga/bg_corridor.webp'), 'Battle scene must use a controlled repository environment asset.');
assert(!/data:image\//i.test(css), 'Large embedded raster data is forbidden in S02 CSS.');
assert(!/a_full_screen_pixel_art_mobile_game_ui/i.test(css + html + js), 'The approved screenshot may not be flattened into the implementation.');

assert(js.includes("'use strict'"), 'S02 JavaScript must run in strict mode.');
assert(js.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'JavaScript reduced-motion state handling is missing.');
assert(js.includes('setAuto('), 'Auto battle state implementation is missing.');
assert(js.includes('setSpeed('), 'Battle-speed state implementation is missing.');
assert(js.includes('activateSkill('), 'Skill cooldown implementation is missing.');
assert(js.includes('activateSupport('), 'Merchant-support state implementation is missing.');
assert(js.includes("root.dataset.ready = 'true'"), 'Browser readiness signal is missing.');
assert(!/fetch\s*\(/.test(js), 'The isolated Step 4 prototype must not call backend APIs.');
assert(!/localStorage|sessionStorage|indexedDB/.test(js), 'The prototype must not mint or persist gameplay state.');
assert(!/Math\.random/.test(js), 'S02 visual/interaction evidence must be deterministic; Math.random is forbidden.');

try {
  execFileSync(process.execPath, ['--check', jsPath], { cwd: root, stdio: 'pipe' });
} catch (error) {
  fail(`JavaScript syntax check failed: ${error.stderr?.toString() || error.message}`);
}

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

for (const [file, expectedBlob] of Object.entries(protectedBlobs)) {
  assert(fs.existsSync(path.join(root, file)), `Protected file disappeared: ${file}`);
  if (fs.existsSync(path.join(root, file))) {
    const actualBlob = git('hash-object', file);
    assert(actualBlob === expectedBlob, `Protected file changed outside the S02 prototype boundary: ${file}`);
  }
}

let changedFiles = [];
try {
  changedFiles = git('diff', '--name-only', `${entryHead}..HEAD`).split('\n').filter(Boolean);
} catch (error) {
  fail(`Unable to inspect S02 change boundary: ${error.message}`);
}

const allowedPathPatterns = [
  /^step4\/s02\//,
  /^tests\/step4\/s02-[^/]+\.mjs$/,
  /^\.github\/workflows\/verify-step-4-s02-anchor\.yml$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-[^/]+$/,
  /^quality-reviews\/step-1-canonical-design\/active-change-control-addendum-round-019\.json$/,
  /^PROJECT_STATUS\.json$/,
  /^AI_PROJECT_POLICY\.json$/,
  /^QUALITY_GATE\.md$/,
  /^\.github\/workflows\/CURRENT_STATUS\.md$/,
  /^PROJECT_HANDOVER\.md$/,
  /^AGENTS\.md$/
];

for (const file of changedFiles) {
  assert(allowedPathPatterns.some((pattern) => pattern.test(file)), `Changed path is outside the isolated S02 boundary: ${file}`);
}

try {
  execFileSync('git', ['diff', '--check', `${entryHead}..HEAD`], { cwd: root, stdio: 'pipe' });
} catch (error) {
  fail(`git diff --check failed: ${error.stderr?.toString() || error.message}`);
}

notes.push(`Validated ${buttonOpenTags.length} buttons and ${imgTags.length} images.`);
notes.push(`Validated ${assetRefs.length} repository asset references.`);
notes.push(`Validated ${changedFiles.length} changed paths against the isolated S02 allowlist.`);

const report = {
  verdict: failures.length === 0 ? 'PASS_S02_STATIC_CONTRACT' : 'FAIL_S02_STATIC_CONTRACT',
  entryHead,
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  notes,
  failures
};

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exit(1);
