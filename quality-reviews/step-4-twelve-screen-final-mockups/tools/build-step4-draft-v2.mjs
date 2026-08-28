#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const V1 = `${STEP4}/tools/build-step4-draft.mjs`;
const SELF = `${STEP4}/tools/build-step4-draft-v2.mjs`;
const MANIFEST = `${STEP4}/render-manifest.json`;
const ENTRY = `${STEP4}/entry-readback.json`;
const SCREEN_IDS = ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12'];
const VIEWPORTS = ['320x667','375x667','390x844'];

const abs = (relativePath) => path.join(ROOT, relativePath);
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const writeText = (relativePath, value) => writeFileSync(abs(relativePath), `${String(value).replace(/[ \t]+$/gm, '').trim()}\n`, 'utf8');
const writeJson = (relativePath, value) => writeText(relativePath, JSON.stringify(value, null, 2));
const sha256 = (relativePath) => createHash('sha256').update(readFileSync(abs(relativePath))).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
assert.equal(git('replace', '-l'), '');

const generated = execFileSync('node', [V1], { cwd: ROOT, encoding: 'utf8' }).trim();
const result = JSON.parse(generated.split('\n').at(-1));
assert.equal(result.verdict, 'PASS_STEP4_DRAFT_GENERATION');
assert.equal(result.renderCount, 36);

for (const screenId of SCREEN_IDS) {
  for (const viewport of VIEWPORTS) {
    const relativePath = `${STEP4}/mockups/${screenId}-${viewport}.svg`;
    let svg = readText(relativePath);
    svg = svg.replaceAll(
      'font-family="system-ui, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif"',
      'font-family="system-ui, -apple-system, BlinkMacSystemFont, Hiragino Sans, Noto Sans JP, sans-serif"',
    );
    svg = svg.replace(/<\/g>\s*<\/svg>\s*$/u, '</svg>');
    writeText(relativePath, svg);
  }
}

const svgPaths = SCREEN_IDS.flatMap((screenId) => VIEWPORTS.map((viewport) => `${STEP4}/mockups/${screenId}-${viewport}.svg`));
execFileSync('python3', ['-c', [
  'import sys, xml.etree.ElementTree as ET',
  'for p in sys.argv[1:]: ET.parse(p)',
].join('\n'), ...svgPaths.map(abs)], { cwd: ROOT, stdio: 'inherit' });

const manifest = readJson(MANIFEST);
manifest.schemaVersion = Math.max(Number(manifest.schemaVersion ?? 1), 2);
manifest.generator = SELF;
manifest.generatorBlob = gitBlob(SELF);
manifest.xmlValidation = {
  parser: 'python3 xml.etree.ElementTree',
  parsedRenderCount: svgPaths.length,
  result: 'PASS',
};
manifest.renders = manifest.renders.map((render) => ({
  ...render,
  bytes: readFileSync(abs(render.path)).length,
  sha256: sha256(render.path),
  xmlParsed: true,
}));
manifest.verdict = 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_GENERATED_V2';
writeJson(MANIFEST, manifest);

const entry = readJson(ENTRY);
entry.schemaVersion = Math.max(Number(entry.schemaVersion ?? 1), 2);
entry.generatedArtifacts.generator = SELF;
entry.generatedArtifacts.generatorBlob = gitBlob(SELF);
entry.generatedArtifacts.xmlValidation = 'PASS';
entry.phase = 'STEP4_XML_VALID_DRAFT_GENERATED_PENDING_CRITICS_AND_FINAL_JUDGE';
entry.verdict = 'PASS_STEP4_ENTRY_AND_XML_VALID_DRAFT_GENERATION_READBACK';
writeJson(ENTRY, entry);

console.log(JSON.stringify({
  verdict: 'PASS_STEP4_DRAFT_GENERATION_V2',
  screenCount: SCREEN_IDS.length,
  viewportCount: VIEWPORTS.length,
  renderCount: svgPaths.length,
  generatorBlob: manifest.generatorBlob,
  xmlValidation: manifest.xmlValidation.result,
}));
