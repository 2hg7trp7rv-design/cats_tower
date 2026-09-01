import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const route = path.join(root, 'step4/s02/golden-master-p1');
const review = path.join(root, 'quality-reviews/step-4-twelve-screen-final-mockups');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const read = (target) => fs.readFileSync(path.join(root, target), 'utf8');
const parse = (target) => JSON.parse(read(target));

const requiredRouteFiles = [
  'step4/s02/golden-master-p1/index.html',
  'step4/s02/golden-master-p1/styles.css',
  'step4/s02/golden-master-p1/app.js',
  'step4/s02/golden-master-p1/asset-manifest.json',
  'step4/s02/golden-master-p1/assets/tower-corridor.webp',
  'step4/s02/golden-master-p1/assets/party-roster.webp',
  'step4/s02/golden-master-p1/assets/party-actions.webp',
  'step4/s02/golden-master-p1/assets/clockwork-marten.webp',
  'step4/s02/golden-master-p1/assets/prior-reference-s02.webp'
];
const requiredReviewFiles = [
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

for (const target of requiredRouteFiles) check(fs.existsSync(path.join(root, target)), `Missing route file: ${target}`);
for (const name of requiredReviewFiles) check(fs.existsSync(path.join(review, name)), `Missing review file: ${name}`);

const index = read('step4/s02/golden-master-p1/index.html');
const css = read('step4/s02/golden-master-p1/styles.css');
const app = read('step4/s02/golden-master-p1/app.js');
const routeText = `${index}\n${css}\n${app}`;
for (const label of ['DESIGN REVIEW', 'S02 GOLDEN MASTER', 'NOT RUNTIME']) check(routeText.includes(label), `Missing review boundary label: ${label}`);
for (let number = 1; number <= 8; number += 1) check(routeText.includes(`GM${String(number).padStart(2, '0')}`), `Missing GM${String(number).padStart(2, '0')}.`);
check(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(routeText), 'Emoji or pictographic Unicode exists in the P1 review implementation.');
check(!/<img[^>]+(?:tower-corridor|party-roster|party-actions)[^>]*>/i.test(index), 'Layer assets may not be pasted as one full-screen Golden Master image.');
check(!/https?:\/\//i.test(routeText), 'Review route has an external runtime dependency.');
check(app.includes('responsiveEvidenceVariants'), 'Seven-viewport responsive evidence variants are absent.');
check(app.includes("battleHeight: 300") && app.includes("battleHeight: 312") && app.includes("battleHeight: 320") && app.includes("battleHeight: 412"), 'Responsive battlefield targets are incomplete.');

function webpHeader(target) {
  const data = fs.readFileSync(path.join(root, target));
  const riff = data.subarray(0, 4).toString('ascii');
  const webp = data.subarray(8, 12).toString('ascii');
  const chunk = data.subarray(12, 16).toString('ascii');
  const alpha = chunk === 'VP8X' && (data[20] & 0x10) === 0x10;
  return { riff, webp, chunk, alpha, bytes: data.length };
}

const background = webpHeader('step4/s02/golden-master-p1/assets/tower-corridor.webp');
const roster = webpHeader('step4/s02/golden-master-p1/assets/party-roster.webp');
const actions = webpHeader('step4/s02/golden-master-p1/assets/party-actions.webp');
const enemy = webpHeader('step4/s02/golden-master-p1/assets/clockwork-marten.webp');
for (const [name, header] of Object.entries({ background, roster, actions, enemy })) check(header.riff === 'RIFF' && header.webp === 'WEBP' && header.bytes > 0, `${name} is not a valid WebP header.`);
check(roster.alpha && actions.alpha && enemy.alpha, 'Character, action and enemy WebPs must expose alpha in VP8X.');

const manifest = parse('step4/s02/golden-master-p1/asset-manifest.json');
check(manifest.purpose === 'DESIGN_REVIEW_ONLY_NOT_RUNTIME', 'Asset manifest runtime boundary is absent.');
check(manifest.assets.every((asset) => asset.textBakedIn !== true && asset.runtimeUseAuthorized === false), 'Asset manifest authorizes baked text or runtime use.');

for (const name of requiredReviewFiles.filter((name) => name.endsWith('.json'))) parse(path.posix.join('quality-reviews/step-4-twelve-screen-final-mockups', name));
const acceptance = parse('quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-acceptance-matrix-round-001.json');
const responsive = parse('quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json');
const art = parse('quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-art-direction.json');
check(acceptance.goldenMasters.length >= 8, 'Acceptance does not define eight Golden Masters.');
check(responsive.viewports?.length === 7 || responsive.viewportContracts?.length === 7, 'Responsive contract does not cover seven required viewports.');
check(JSON.stringify(art).includes('PREMIUM_PIXEL_ART_CHIBI'), 'Art direction does not lock the premium pixel-art chibi language.');

const report = {
  verdict: failures.length === 0 ? 'PASS_S02_GOLDEN_MASTER_P1_STATIC' : 'FAIL_S02_GOLDEN_MASTER_P1_STATIC',
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  requiredRouteFileCount: requiredRouteFiles.length,
  requiredReviewFileCount: requiredReviewFiles.length,
  webpHeaders: { background, roster, actions, enemy },
  productionChanged: false,
  physicalIPhone: 'NOT_VERIFIED',
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
