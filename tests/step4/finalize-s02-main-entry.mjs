import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (relative, content) => fs.writeFileSync(path.join(root, relative), content.endsWith('\n') ? content : `${content}\n`, 'utf8');
const readJson = (relative) => JSON.parse(read(relative));
const writeJson = (relative, value) => write(relative, JSON.stringify(value, null, 2));
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');

const staticReportPath = 's02-static-v3-report.json';
const sourceReportPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-browser-evidence/report.json';
const mainReportPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/report.json';
const evidencePath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-integration-evidence.json';

const staticReport = readJson(staticReportPath);
const sourceReport = readJson(sourceReportPath);
const mainReport = readJson(mainReportPath);
if (staticReport.verdict !== 'PASS_S02_STATIC_CONTRACT_V3') throw new Error(`Static contract did not pass: ${staticReport.verdict}`);
if (sourceReport.verdict !== 'PASS_S02_BROWSER_QA') throw new Error(`Source browser QA did not pass: ${sourceReport.verdict}`);
if (mainReport.verdict !== 'PASS_S02_MAIN_ENTRY_BROWSER_QA') throw new Error(`Root browser QA did not pass: ${mainReport.verdict}`);
if (git('hash-object', 'legacy.html') !== 'c5871ded0f7fbb501dce08e2b0da767841ce789b') throw new Error('Legacy runtime blob is not preserved.');

const rootScreenshots = [
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/root-320x667-normal.png',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/root-375x667-normal.png',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/root-390x844-normal.png',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/root-390x844-interaction.png',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/root-390x844-large-text.png',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/root-390x844-reduced-motion.png',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-main-entry-evidence/source-390x844-normal.png'
];
for (const relative of rootScreenshots) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing screenshot: ${relative}`);
}

const now = new Date().toISOString();
const entryHead = git('rev-parse', 'HEAD');
const entryTree = git('rev-parse', 'HEAD^{tree}');
const workflowRunId = process.env.GITHUB_RUN_ID || null;
const workflowRunUrl = workflowRunId ? `https://github.com/2hg7trp7rv-design/cats_tower/actions/runs/${workflowRunId}` : null;

const evidence = {
  schemaVersion: 1,
  artifactId: 'cats-tower-step4-s02-main-entry-integration-evidence',
  generatedAt: now,
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  entry: {
    head: entryHead,
    tree: entryTree
  },
  workflow: {
    name: process.env.GITHUB_WORKFLOW || 'local',
    runId: workflowRunId,
    runUrl: workflowRunUrl,
    event: process.env.GITHUB_EVENT_NAME || 'local'
  },
  verdict: 'PASS_S02_MAIN_ENTRY_TECHNICAL_PENDING_USER_VISUAL_APPROVAL',
  actualGameEntry: {
    path: '/',
    source: '/step4/s02/index.html',
    composition: 'same-origin DOM mount',
    iframe: false,
    redirect: false,
    flattenedScreenshot: false,
    rootBrowserVerified: true
  },
  preservedLegacyRuntime: {
    path: '/legacy.html',
    blob: 'c5871ded0f7fbb501dce08e2b0da767841ce789b',
    browserVerified: true
  },
  validation: {
    staticContract: staticReport.verdict,
    isolatedSourceBrowser: sourceReport.verdict,
    actualRootBrowser: mainReport.verdict,
    viewports: ['320x667', '375x667', '390x844'],
    interactionFlow: 'PASS',
    largeText: 'PASS_BROWSER_SIMULATION_NOT_PHYSICAL_IOS',
    reducedMotion: 'PASS_CHROMIUM',
    consoleErrors: 0,
    pageErrors: 0
  },
  screenshots: rootScreenshots.map((relative) => ({ path: relative, sha256: sha256(relative) })),
  visualState: {
    approvedDirectionImplemented: true,
    exactRootRenderShownToUser: false,
    userFinalRootApproval: 'PENDING',
    unresolvedP0: 0,
    unresolvedP1: 1,
    remainingP1: 'The exact current root browser render must be explicitly approved before S02 visual completion.'
  },
  scopeReadback: {
    step4Status: 'IN_PROGRESS',
    step4Pass: false,
    step5Allowed: false,
    backendChanged: false,
    paymentProviderChanged: false,
    adNetworkChanged: false,
    productionAliasChanged: false,
    physicalIPhoneVerified: false,
    otherBranchWritten: false,
    pullRequestOperation: false
  }
};
writeJson(evidencePath, evidence);

function updateJson(relative, mutate) {
  const value = readJson(relative);
  mutate(value);
  writeJson(relative, value);
}

updateJson('PROJECT_STATUS.json', (value) => {
  value.updatedDate = '2026-08-29';
  value.currentStep = 4;
  value.currentStepStatus = 'IN_PROGRESS';
  value.currentCheckpoint = 'step4-s02-main-entry-integrated-pending-user-approval';
  value.advanceAllowed = false;
  value.step5Allowed = false;
  value.nextAction = 'Show the exact root browser render to the user, resolve the remaining visual P1, then proceed to S01, S08 and S10 only after S02 root approval.';
  value.step4 = {
    ...(value.step4 || {}),
    status: 'IN_PROGRESS',
    actualGameEntry: 'S02_INTEGRATED_AT_ROOT',
    isolatedSource: '/step4/s02/',
    preservedLegacyEntry: '/legacy.html',
    mainEntryIntegration: 'PASS_TECHNICAL_PENDING_USER_VISUAL_APPROVAL',
    mainEntryEvidence: evidencePath,
    rootBrowserRenderedEvidence: 'PASS_EXACT_WORKFLOW_WORKTREE',
    requiredViewports: ['320x667', '375x667', '390x844'],
    largeText: 'PASS_BROWSER_SIMULATION_NOT_PHYSICAL_IOS',
    reducedMotion: 'PASS_CHROMIUM',
    userFinalRootApproval: 'PENDING',
    unresolvedP0: 0,
    unresolvedP1: 1,
    step4Pass: false,
    step5Allowed: false
  };
});

updateJson('AI_PROJECT_POLICY.json', (value) => {
  value.updatedDate = '2026-08-29';
  value.step4MainEntryIntegration = {
    status: 'PASS_TECHNICAL_PENDING_USER_VISUAL_APPROVAL',
    root: '/',
    source: '/step4/s02/',
    legacy: '/legacy.html',
    evidence: evidencePath,
    step4Pass: false,
    step5Allowed: false,
    productionAliasChanged: false,
    physicalIPhoneVerified: false
  };
});

updateJson('simulation/CURRENT_STATUS.json', (value) => {
  value.updatedDate = '2026-08-29';
  value.step4MainEntryIntegration = {
    status: 'PASS_TECHNICAL_PENDING_USER_VISUAL_APPROVAL',
    evidence: evidencePath,
    actualGameEntry: '/',
    step4Pass: false,
    step5Allowed: false
  };
});

updateJson('quality-reviews/step-1-canonical-design/active-change-control.json', (value) => {
  value.revision = Number(value.revision || 0) + 1;
  value.updatedAt = now;
  value.latestAddendum = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-022.json';
  value.step4Allowed = true;
  value.step5Allowed = false;
  value.currentStep = 4;
  value.currentStatus = 'IN_PROGRESS';
  value.s02MainEntryIntegration = {
    status: 'PASS_TECHNICAL_PENDING_USER_VISUAL_APPROVAL',
    evidence: evidencePath,
    actualGameEntry: '/',
    preservedLegacyEntry: '/legacy.html',
    step4Pass: false,
    step5Allowed: false,
    productionAliasChanged: false,
    physicalIPhoneVerified: false
  };
});

const sectionStart = '<!-- STEP4_S02_MAIN_ENTRY_START -->';
const sectionEnd = '<!-- STEP4_S02_MAIN_ENTRY_END -->';
const section = `${sectionStart}
## Step 4 S02 actual game-entry checkpoint — 2026-08-29

- Actual game entry \`/\`: **S02 integrated and browser-verified**
- Single visual source: \`/step4/s02/\`
- Preserved previous Canvas runtime: \`/legacy.html\`
- Technical verdict: **PASS_TECHNICAL_PENDING_USER_VISUAL_APPROVAL**
- Required viewports: **320×667 / 375×667 / 390×844 — PASS**
- Interaction / Reduce Motion: **PASS**
- Large Text: **PASS_BROWSER_SIMULATION_NOT_PHYSICAL_IOS**
- Unresolved P0 / P1: **0 / 1**
- Remaining P1: exact root browser render requires explicit user approval
- Step 4: **IN_PROGRESS**
- Step 5: **BLOCKED**
- Production alias: **UNCHANGED**
- Physical iPhone: **NOT_VERIFIED**
- Evidence: \`${evidencePath}\`
${sectionEnd}`;

function upsertSection(relative) {
  let content = read(relative);
  const start = content.indexOf(sectionStart);
  const end = content.indexOf(sectionEnd);
  if (start !== -1 && end !== -1 && end >= start) {
    content = `${content.slice(0, start)}${section}${content.slice(end + sectionEnd.length)}`;
  } else {
    content = `${content.trimEnd()}\n\n${section}\n`;
  }
  write(relative, content);
}

for (const relative of [
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  '.github/workflows/CURRENT_STATUS.md'
]) upsertSection(relative);

console.log(JSON.stringify({
  verdict: evidence.verdict,
  evidencePath,
  updatedMirrors: [
    'PROJECT_STATUS.json',
    'AI_PROJECT_POLICY.json',
    'simulation/CURRENT_STATUS.json',
    'quality-reviews/step-1-canonical-design/active-change-control.json',
    'QUALITY_GATE.md',
    'PROJECT_HANDOVER.md',
    'AGENTS.md',
    '.github/workflows/CURRENT_STATUS.md'
  ],
  screenshots: evidence.screenshots.length,
  unresolvedP0: 0,
  unresolvedP1: 1,
  step4Pass: false,
  step5Allowed: false
}, null, 2));
