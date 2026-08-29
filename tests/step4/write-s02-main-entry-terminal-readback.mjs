import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));
const writeJson = (relative, value) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const evidencePath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-integration-evidence.json';
const sourceReportPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-browser-evidence/report.json';
const mainReportPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/report.json';
const terminalPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-terminal-readback.json';

for (const relative of [evidencePath, sourceReportPath, mainReportPath, 'index.html', 'legacy.html']) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Required terminal input is missing: ${relative}`);
}

const evidence = readJson(evidencePath);
const sourceReport = readJson(sourceReportPath);
const mainReport = readJson(mainReportPath);
if (evidence.verdict !== 'PASS_S02_MAIN_ENTRY_TECHNICAL_PENDING_USER_VISUAL_APPROVAL') throw new Error(`Unexpected integration evidence verdict: ${evidence.verdict}`);
if (sourceReport.verdict !== 'PASS_S02_BROWSER_QA') throw new Error(`Unexpected source report verdict: ${sourceReport.verdict}`);
if (mainReport.verdict !== 'PASS_S02_MAIN_ENTRY_BROWSER_QA') throw new Error(`Unexpected root report verdict: ${mainReport.verdict}`);
if (git('hash-object', 'legacy.html') !== 'c5871ded0f7fbb501dce08e2b0da767841ce789b') throw new Error('Legacy runtime blob changed.');
if (!read('index.html').includes('/step4/s02/root-entry.js')) throw new Error('Root no longer mounts S02.');

const terminal = {
  schemaVersion: 1,
  artifactId: 'cats-tower-step4-s02-main-entry-terminal-readback',
  generatedAt: new Date().toISOString(),
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  exactReadback: {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    workflow: process.env.GITHUB_WORKFLOW || 'local',
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowRunUrl: process.env.GITHUB_RUN_ID ? `https://github.com/2hg7trp7rv-design/cats_tower/actions/runs/${process.env.GITHUB_RUN_ID}` : null
  },
  verdict: 'PASS_S02_MAIN_ENTRY_TERMINAL_TECHNICAL_PENDING_USER_VISUAL_APPROVAL',
  rootReadback: {
    actualGameEntry: '/',
    s02Source: '/step4/s02/',
    legacyEntry: '/legacy.html',
    sameOriginDomMount: true,
    iframe: false,
    redirect: false,
    flattenedScreenshot: false,
    sourceBrowserVerdict: sourceReport.verdict,
    rootBrowserVerdict: mainReport.verdict,
    preservedLegacyBlob: 'c5871ded0f7fbb501dce08e2b0da767841ce789b'
  },
  acceptanceReadback: {
    viewports: ['320x667', '375x667', '390x844'],
    interaction: 'PASS',
    reducedMotion: 'PASS_CHROMIUM',
    largeText: 'PASS_BROWSER_SIMULATION_NOT_PHYSICAL_IOS',
    consoleErrors: 0,
    pageErrors: 0,
    unresolvedP0: 0,
    unresolvedP1: 1,
    remainingP1: 'Exact current root render requires explicit user approval.'
  },
  governanceDecision: {
    step4: 'IN_PROGRESS',
    step4Pass: false,
    step5Allowed: false,
    productionAliasChanged: false,
    physicalIPhoneVerified: false,
    nextAction: 'Present exact root screenshots to the user and resolve the remaining visual P1.'
  },
  supportingEvidence: evidencePath
};
writeJson(terminalPath, terminal);

const project = readJson('PROJECT_STATUS.json');
project.updatedDate = '2026-08-29';
project.currentCheckpoint = 'step4-s02-main-entry-terminal-pending-user-approval';
project.step4 = {
  ...(project.step4 || {}),
  actualGameEntry: 'S02_INTEGRATED_AT_ROOT',
  mainEntryIntegration: 'PASS_TECHNICAL_PENDING_USER_VISUAL_APPROVAL',
  terminalReadback: terminalPath,
  terminalVerdict: terminal.verdict,
  userFinalRootApproval: 'PENDING',
  unresolvedP0: 0,
  unresolvedP1: 1,
  step4Pass: false,
  step5Allowed: false
};
project.step5Allowed = false;
project.advanceAllowed = false;
writeJson('PROJECT_STATUS.json', project);

console.log(JSON.stringify({
  verdict: terminal.verdict,
  terminalPath,
  exactHead: terminal.exactReadback.head,
  exactTree: terminal.exactReadback.tree,
  unresolvedP0: 0,
  unresolvedP1: 1,
  step4Pass: false,
  step5Allowed: false
}, null, 2));
