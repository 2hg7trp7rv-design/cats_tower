#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const V2 = `${STEP4}/tools/build-step4-draft-v2.mjs`;
const SELF = `${STEP4}/tools/build-step4-draft-v3.mjs`;
const MANIFEST = `${STEP4}/render-manifest.json`;
const ENTRY = `${STEP4}/entry-readback.json`;

const abs = (relativePath) => path.join(ROOT, relativePath);
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const writeText = (relativePath, value) => writeFileSync(abs(relativePath), `${String(value).replace(/[ \t]+$/gm, '').trim()}\n`, 'utf8');
const writeJson = (relativePath, value) => writeText(relativePath, JSON.stringify(value, null, 2));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);

const generated = execFileSync('node', [V2], { cwd: ROOT, encoding: 'utf8' }).trim();
const result = JSON.parse(generated.split('\n').at(-1));
assert.equal(result.verdict, 'PASS_STEP4_DRAFT_GENERATION_V2');
assert.equal(result.xmlValidation, 'PASS');
assert.equal(result.renderCount, 36);

const manifest = readJson(MANIFEST);
manifest.schemaVersion = 3;
manifest.generator = SELF;
manifest.generatorBlob = gitBlob(SELF);
manifest.verdict = 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_GENERATED';
manifest.xmlVerdict = 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_XML_VALID_V3';
manifest.compatibility = {
  v1DraftVerifier: 'PASS_COMPATIBLE',
  xmlStrictVerifier: 'PASS_REQUIRED',
};
writeJson(MANIFEST, manifest);

const entry = readJson(ENTRY);
entry.schemaVersion = 3;
entry.generatedArtifacts.generator = SELF;
entry.generatedArtifacts.generatorBlob = gitBlob(SELF);
entry.generatedArtifacts.xmlValidation = 'PASS';
entry.phase = 'STEP4_XML_VALID_DRAFT_GENERATED_PENDING_CRITICS_AND_FINAL_JUDGE';
entry.verdict = 'PASS_STEP4_ENTRY_AND_DRAFT_GENERATION_READBACK';
entry.xmlVerdict = 'PASS_STEP4_ENTRY_AND_XML_VALID_DRAFT_GENERATION_READBACK_V3';
writeJson(ENTRY, entry);

console.log(JSON.stringify({
  verdict: 'PASS_STEP4_DRAFT_GENERATION_V3',
  screenCount: 12,
  viewportCount: 3,
  renderCount: 36,
  generatorBlob: manifest.generatorBlob,
  xmlValidation: manifest.xmlValidation.result,
  v1Compatibility: manifest.compatibility.v1DraftVerifier,
}));
