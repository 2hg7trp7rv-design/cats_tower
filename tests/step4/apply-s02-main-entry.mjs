import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const rootIndexPath = path.join(root, 'index.html');
const legacyPath = path.join(root, 'legacy.html');
const s02IndexPath = path.join(root, 'step4/s02/index.html');
const expectedLegacyBlob = 'c5871ded0f7fbb501dce08e2b0da767841ce789b';

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, content) => fs.writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`, 'utf8');

if (!fs.existsSync(rootIndexPath)) throw new Error('Root index.html is missing.');
if (!fs.existsSync(s02IndexPath)) throw new Error('step4/s02/index.html is missing.');

if (!fs.existsSync(legacyPath)) {
  const currentRootBlob = git('hash-object', 'index.html');
  if (currentRootBlob !== expectedLegacyBlob) {
    throw new Error(`Refusing to preserve an unexpected root document: ${currentRootBlob}`);
  }
  fs.copyFileSync(rootIndexPath, legacyPath);
}

const preservedBlob = git('hash-object', 'legacy.html');
if (preservedBlob !== expectedLegacyBlob) {
  throw new Error(`legacy.html does not preserve the sealed pre-integration root: ${preservedBlob}`);
}

let s02Index = read(s02IndexPath);
const productionLink = '  <link rel="stylesheet" href="./production.css">';
if (!s02Index.includes('href="./production.css"')) {
  const refinementLink = '  <link rel="stylesheet" href="./refinement.css">';
  if (!s02Index.includes(refinementLink)) {
    throw new Error('S02 refinement stylesheet link was not found.');
  }
  s02Index = s02Index.replace(refinementLink, `${refinementLink}\n${productionLink}`);
  write(s02IndexPath, s02Index);
}

const rootIndex = `<!doctype html>
<html lang="ja" data-main-entry-ready="pending">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
  <meta name="theme-color" content="#21130f">
  <meta name="description" content="Cat's Tower S02 integrated game entry on the kimi validation branch">
  <title>Cat's Tower — 25F 静寂の森</title>
  <link rel="stylesheet" href="/step4/s02/styles.css">
  <link rel="stylesheet" href="/step4/s02/refinement.css">
  <link rel="stylesheet" href="/step4/s02/production.css">
</head>
<body>
  <main id="game-root" class="main-entry-loading" aria-live="polite" aria-busy="true">
    <div class="main-entry-spinner" aria-hidden="true"></div>
    <p>Cat's Towerを準備しています…</p>
  </main>
  <noscript>
    <main class="main-entry-failure">
      <h1>JavaScriptを有効にしてください</h1>
      <p><a href="/legacy.html">旧ビルドを開く</a></p>
    </main>
  </noscript>
  <script src="/step4/s02/root-entry.js" defer></script>
</body>
</html>`;
write(rootIndexPath, rootIndex);

const changed = git('diff', '--name-only').split('\n').filter(Boolean);
const allowed = new Set(['index.html', 'legacy.html', 'step4/s02/index.html']);
const unexpected = changed.filter((file) => !allowed.has(file));
if (unexpected.length) throw new Error(`Unexpected integration output: ${unexpected.join(', ')}`);

if (/<(?:iframe|object|embed)\b/i.test(rootIndex)) throw new Error('Embedded-document integration is forbidden.');
if (/http-equiv=["']refresh/i.test(rootIndex)) throw new Error('Meta refresh is forbidden.');
if (/location\.(?:assign|replace)|location\s*=/i.test(rootIndex)) throw new Error('Location redirect is forbidden.');
if (!rootIndex.includes('/step4/s02/root-entry.js')) throw new Error('Root composition module is missing.');
if (!s02Index.includes('href="./production.css"')) throw new Error('S02 production layer is not connected.');

console.log(JSON.stringify({
  verdict: 'PASS_S02_MAIN_ENTRY_APPLY',
  headBeforeApply: git('rev-parse', 'HEAD'),
  preservedLegacyBlob: preservedBlob,
  changedPaths: changed,
  rootComposition: 'same-origin DOM mount',
  step4Pass: false,
  step5Allowed: false,
  productionAliasChanged: false,
  physicalIPhoneVerified: false
}, null, 2));
