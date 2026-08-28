#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const GENERATOR = `${STEP4}/tools/build-step4-draft-v2.mjs`;
const MANIFEST = `${STEP4}/render-manifest.json`;
const V1_VERIFIER = 'tests/step4/verify-step4-mockups.mjs';
const SCREEN_IDS = ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12'];
const VIEWPORTS = ['320x667','375x667','390x844'];

const abs = (relativePath) => path.join(ROOT, relativePath);
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);

const v1Output = execFileSync('node', [V1_VERIFIER], { cwd: ROOT, encoding: 'utf8' }).trim();
const v1Result = JSON.parse(v1Output.split('\n').at(-1));
assert.equal(v1Result.verdict, 'PASS_STEP4_MOCKUP_DRAFT_VALIDATION');
assert.equal(v1Result.forbiddenPathCount, 0);

const manifest = readJson(MANIFEST);
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.generator, GENERATOR);
assert.equal(manifest.generatorBlob, gitBlob(GENERATOR));
assert.equal(manifest.renderCount, 36);
assert.equal(manifest.xmlValidation.result, 'PASS');
assert.equal(manifest.xmlValidation.parsedRenderCount, 36);
assert.equal(manifest.verdict, 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_GENERATED_V2');
assert(manifest.renders.every((render) => render.xmlParsed === true));

const svgPaths = SCREEN_IDS.flatMap((screenId) => VIEWPORTS.map((viewport) => `${STEP4}/mockups/${screenId}-${viewport}.svg`));
execFileSync('python3', ['-c', [
  'import sys, xml.etree.ElementTree as ET',
  'for p in sys.argv[1:]: ET.parse(p)',
].join('\n'), ...svgPaths.map(abs)], { cwd: ROOT, stdio: 'inherit' });

for (const relativePath of svgPaths) {
  const svg = readText(relativePath);
  assert(!svg.includes('font-family="system-ui, -apple-system, BlinkMacSystemFont, "'), `${relativePath}: malformed nested font quotes`);
  const openGroups = (svg.match(/<g(?:\s|>)/gu) ?? []).length;
  const closeGroups = (svg.match(/<\/g>/gu) ?? []).length;
  assert.equal(openGroups, closeGroups, `${relativePath}: unbalanced SVG groups`);
  assert.match(svg, /^<svg\b/u);
  assert.match(svg, /<\/svg>\s*$/u);
}

const entry = readJson(`${STEP4}/entry-readback.json`);
assert.equal(entry.schemaVersion, 2);
assert.equal(entry.generatedArtifacts.generator, GENERATOR);
assert.equal(entry.generatedArtifacts.generatorBlob, gitBlob(GENERATOR));
assert.equal(entry.generatedArtifacts.xmlValidation, 'PASS');
assert.equal(entry.verdict, 'PASS_STEP4_ENTRY_AND_XML_VALID_DRAFT_GENERATION_READBACK');

console.log(JSON.stringify({
  verdict: 'PASS_STEP4_MOCKUP_DRAFT_VALIDATION_V2',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  screenCount: SCREEN_IDS.length,
  viewportCount: VIEWPORTS.length,
  renderCount: svgPaths.length,
  xmlParsed: true,
  generatorBlob: manifest.generatorBlob,
  forbiddenPathCount: v1Result.forbiddenPathCount,
  physicalIPhone: 'NOT_VERIFIED',
  productionChanged: false,
}));
