import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const args = process.argv.slice(2);
const mode = args[0];
const step3Dir = 'quality-reviews/step-3-large-scale-validation';
const acceptancePath = `${step3Dir}/acceptance-matrix.json`;
const analysisPath = `${step3Dir}/analysis.json`;
const finalJudgePath = `${step3Dir}/final-judge.json`;
const completionPath = `${step3Dir}/completion-evidence.json`;
const liveReadbackPath = `${step3Dir}/live-readback.json`;
const repairBase = '3eefbf6fa7dfcec8b5b093612e8946b43d838bc2';
const expectedRepo = '2hg7trp7rv-design/cats_tower';
const expectedBranch = 'kimi';

const readText = p => readFileSync(path.join(root,p),'utf8');
const writeText = (p,s) => { mkdirSync(path.dirname(path.join(root,p)),{recursive:true}); writeFileSync(path.join(root,p),s); };
const readJson = p => JSON.parse(readText(p));
const writeJson = (p,v) => writeText(p, JSON.stringify(v,null,2)+'\n');
const git = (...a) => execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
const blob = p => git('rev-parse',`HEAD:${p}`);
const fileSha256 = p => createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex');
const now = () => new Date().toISOString();
function assertExactRepo() {
  assert.equal(process.env.GITHUB_REPOSITORY ?? expectedRepo, expectedRepo);
  const refName = process.env.GITHUB_REF_NAME ?? expectedBranch;
  assert.equal(refName, expectedBranch);
  assert.equal(readJson(acceptancePath).repository, expectedRepo);
  assert.equal(readJson(acceptancePath).branch, expectedBranch);
  assert.equal(readJson(acceptancePath).entry.head, repairBase);
  execFileSync('git',['merge-base','--is-ancestor',repairBase,'HEAD'],{cwd:root});
}
function updateMarkdownStatus(p, phase) {
  let s = readText(p);
  if (phase === 'IN_PROGRESS') {
    const replacements = [
      ['Step 3: **READY_TO_START**','Step 3: **IN_PROGRESS — LARGE_SCALE_VALIDATION**'],
      ['現在工程: **Step 2 — PASS / SEALED**','現在工程: **Step 3 — IN_PROGRESS / LARGE_SCALE_VALIDATION**'],
      ['次工程: **Step 3 — READY_TO_START**','次工程: **Step 4 — BLOCKED_UNTIL_STEP3_PASS**'],
      ['Current: **Step 2 — PASS / SEALED**','Current: **Step 3 — IN_PROGRESS / LARGE_SCALE_VALIDATION**'],
    ];
    let changed = false;
    for (const [a,b] of replacements) if (s.includes(a)) { s = s.split(a).join(b); changed = true; }
    if (!changed && !s.includes('Step 3 — IN_PROGRESS') && !s.includes('Step 3: **IN_PROGRESS')) throw new Error(`${p}: no Step 3 activation marker was updated`);
  } else {
    const pass = phase === 'PASS';
    const replacements = [
      ['Step 3: **IN_PROGRESS — LARGE_SCALE_VALIDATION**', `Step 3: **${pass ? 'PASS — LARGE_SCALE_VALIDATION' : 'FAIL — SEALED_CANDIDATE_REJECTED'}**`],
      ['現在工程: **Step 3 — IN_PROGRESS / LARGE_SCALE_VALIDATION**', `現在工程: **Step 3 — ${pass ? 'PASS / LARGE_SCALE_VALIDATION' : 'FAIL / SEALED_CANDIDATE_REJECTED'}**`],
      ['次工程: **Step 4 — BLOCKED_UNTIL_STEP3_PASS**', `次工程: **Step 4 — ${pass ? 'READY_TO_START' : 'BLOCKED_BY_STEP3_FAILURE'}**`],
      ['Current: **Step 3 — IN_PROGRESS / LARGE_SCALE_VALIDATION**', `Current: **Step 3 — ${pass ? 'PASS / LARGE_SCALE_VALIDATION' : 'FAIL / SEALED_CANDIDATE_REJECTED'}**`],
    ];
    let changed = false;
    for (const [a,b] of replacements) if (s.includes(a)) { s = s.split(a).join(b); changed = true; }
    if (!changed && !s.includes(`Step 3 — ${pass ? 'PASS' : 'FAIL'}`) && !s.includes(`Step 3: **${pass ? 'PASS' : 'FAIL'}`)) throw new Error(`${p}: no Step 3 terminal marker was updated`);
  }
  writeText(p,s);
}
function setSequenceStatus(obj, status) {
  const sequence = obj.authorizedExecutionSequence ?? obj.executionState;
  if (Array.isArray(sequence)) {
    for (const row of sequence) {
      const step = row.order ?? row.step;
      if (step === 3) row.status = status;
      if (step === 4) row.status = status === 'PASS' ? 'READY_TO_START' : 'BLOCKED_UNTIL_STEP3_PASS';
    }
  }
}
function activate() {
  assertExactRepo();
  assert(!existsSync(path.join(root,completionPath)), 'Step 3 completion already exists');
  const acceptance = readJson(acceptancePath);
  assert.equal(acceptance.status,'ACTIVE_BEFORE_FIRST_STEP3_WRITE');

  const acc = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
  acc.schemaVersion = Math.max(Number(acc.schemaVersion ?? 1),1);
  acc.revision = Number(acc.revision ?? 7) + 1;
  acc.updatedAt = '2026-08-28';
  acc.status = 'IN_PROGRESS';
  acc.verdict = 'IN_PROGRESS';
  acc.advanceAllowed = false;
  acc.step3Allowed = true;
  acc.step4Allowed = false;
  acc.trigger = 'Execute the exact sealed Step 3 large-scale validation matrix, unseen holdout and six high-volume suites without changing the Step 2 executable candidate.';
  acc.activationEvidence = acc.activationEvidence ?? {};
  acc.activationEvidence.latestAddendum = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json';
  setSequenceStatus(acc,'IN_PROGRESS');
  acc.nextAuthorizedChat = '03_3ビルド・ガチャ・重複熟練・進化・課金検証';
  acc.nextAuthorizedAction = 'Execute and judge the sealed Step 3 large-scale validation only. Holdout must remain unseen for tuning.';
  acc.physicalIPhoneVerified = false;
  acc.productionAliasChanged = false;
  writeJson('quality-reviews/step-1-canonical-design/active-change-control.json',acc);

  const addendum = {
    schemaVersion: 1,
    artifactId: 'step-1-canonical-design-active-change-control-addendum-round-015',
    createdAt: '2026-08-28', activatedAt: '2026-08-28', repository: expectedRepo, branch: expectedBranch,
    parentChangeControl: 'quality-reviews/step-1-canonical-design/active-change-control.json',
    previousAddendum: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-014.json',
    trigger: 'Start Step 3 only after live re-verification of the Step 1 seal, Step 2 executable seal and governance terminal read-back.',
    acceptance: { path: acceptancePath, blob: blob(acceptancePath), entryCommit: acceptance.entry.head, entryTree: acceptance.entry.tree },
    sealedExecution: acceptance.sealedExecution,
    gameplayMatrix: acceptance.gameplayMatrix,
    highVolumeSuites: acceptance.highVolumeSuites,
    status: 'IN_PROGRESS', verdict: 'IN_PROGRESS', step3Allowed: true, step4Allowed: false,
    holdoutPolicy: { unseenForTuning: true, candidateMutationDuringRound: false, tuningAfterObservation: false },
    forbiddenChanges: acceptance.forbiddenChanges,
    physicalIPhoneVerified: false, productionAliasChanged: false,
  };
  writeJson('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json',addendum);

  const policy = readJson('AI_PROJECT_POLICY.json');
  policy.schemaVersion = Number(policy.schemaVersion ?? 5) + 1;
  policy.updatedDate = '2026-08-28';
  policy.currentPhase = { step: 3, name: 'large-scale-validation', status: 'IN_PROGRESS', phase: 'SEALED_CANDIDATE_EXECUTION', step1Status: 'PASS', step2Status: 'PASS_SEALED', step3Allowed: true, step4Allowed: false, balanceVerdict: 'IN_PROGRESS_STEP3', physicalIPhone: 'NOT_VERIFIED' };
  policy.writeBoundary = {
    currentAllowed: ['Step 3 gameplay calibration/holdout results, high-volume results, validators, critics, final judge and evidence'],
    currentForbidden: ['runtime','assets','backend','payment provider','ad network','PR operation','Production alias','Step 2 executable mutation','physical-iPhone PASS claim']
  };
  writeJson('AI_PROJECT_POLICY.json',policy);

  const project = readJson('PROJECT_STATUS.json');
  project.updatedDate = '2026-08-28';
  project.currentStep = 3;
  project.status = 'IN_PROGRESS';
  project.phase = 'LARGE_SCALE_VALIDATION';
  project.step3Allowed = true; project.step4Allowed = false;
  project.balanceVerdict = 'IN_PROGRESS_STEP3';
  project.reason = 'Step 3 sealed-candidate large-scale validation is executing. Step 4 remains blocked until final judge, completion evidence and live read-back pass.';
  project.step3 = { status: 'IN_PROGRESS', acceptance: acceptancePath, candidateMutation: false, holdoutTuningReuse: false, gameplayScenariosPlanned: '15000', highVolumeSamplesPlanned: '1800000' };
  project.physicalIPhoneVerified = false; project.productionAliasChanged = false;
  writeJson('PROJECT_STATUS.json',project);

  const simulation = readJson('simulation/CURRENT_STATUS.json');
  simulation.schemaVersion = Number(simulation.schemaVersion ?? 6) + 1;
  simulation.updatedDate = '2026-08-28'; simulation.currentStep = 3; simulation.status = 'IN_PROGRESS'; simulation.phase = 'LARGE_SCALE_VALIDATION';
  simulation.step3Allowed = true; simulation.step4Allowed = false; simulation.balanceVerdict = 'IN_PROGRESS_STEP3';
  simulation.reason = 'Executing 12000 calibration, 3000 unseen holdout and six sealed high-volume suites. Candidate mutation and holdout tuning reuse are forbidden.';
  simulation.step3 = { status: 'IN_PROGRESS', acceptance: acceptancePath, gameplayCalibration: 'PENDING', gameplayHoldout: 'PENDING_UNSEEN', highVolume: 'PENDING', critics: 'PENDING', finalJudge: 'PENDING', completionEvidence: 'PENDING', liveReadback: 'PENDING' };
  simulation.physicalIPhoneVerified = false; simulation.productionChanged = false;
  writeJson('simulation/CURRENT_STATUS.json',simulation);

  for (const p of ['QUALITY_GATE.md','.github/workflows/CURRENT_STATUS.md','AGENTS.md','PROJECT_HANDOVER.md']) updateMarkdownStatus(p,'IN_PROGRESS');
  console.log(JSON.stringify({ verdict:'PASS_STEP3_ACTIVATION_READY_TO_COMMIT', acceptanceBlob: blob(acceptancePath) }));
}
function criticRecord(id, role, findingIds, analysis, targetCommit, targetTree) {
  const selected = analysis.findings.filter(x => findingIds.includes(x.id));
  const failed = selected.filter(x => x.status !== 'PASS');
  return {
    schemaVersion: 1, artifactId: id, role, recordedAt: now(), repository: expectedRepo, branch: expectedBranch,
    reviewTargetCommit: targetCommit, reviewTargetTree: targetTree,
    analysis: { path: analysisPath, sha256: fileSha256(analysisPath), preReviewVerdict: analysis.preReviewVerdict },
    reviewedFindings: selected.map(x => ({ id:x.id, status:x.status, severity:x.severity, summary:x.summary })),
    unresolvedP0: failed.filter(x => x.severity === 'P0').length,
    unresolvedP1: failed.filter(x => x.severity === 'P1').length,
    findings: failed.map(x => ({ severity:x.severity, acceptanceId:x.id, summary:x.summary, evidence:x.evidence })),
    verdict: failed.length ? 'FAIL' : 'PASS'
  };
}
function review() {
  assertExactRepo();
  const analysis = readJson(analysisPath);
  const targetCommit = git('rev-parse','HEAD'); const targetTree = git('rev-parse','HEAD^{tree}');
  const critics = [
    criticRecord('cats-tower-step3-critic-product-progression','product-progression',['S3-02','S3-05','S3-09'],analysis,targetCommit,targetTree),
    criticRecord('cats-tower-step3-critic-economy-probability','economy-probability',['S3-04','S3-06','S3-08'],analysis,targetCommit,targetTree),
    criticRecord('cats-tower-step3-critic-duplicate-evolution','duplicate-evolution',['S3-05','S3-07','S3-08'],analysis,targetCommit,targetTree),
    criticRecord('cats-tower-step3-critic-ledger-fraud','server-ledger-fraud',['S3-04','S3-06','S3-07'],analysis,targetCommit,targetTree),
    criticRecord('cats-tower-step3-critic-repository-evidence','repository-evidence',['S3-01','S3-02','S3-03','S3-04'],analysis,targetCommit,targetTree),
  ];
  const paths = [];
  critics.forEach((c,i) => { const p=`${step3Dir}/critics/critic-${String(i+1).padStart(2,'0')}-${c.role}.json`; writeJson(p,c); paths.push(p); });
  const unresolvedP0 = critics.reduce((n,c)=>n+c.unresolvedP0,0);
  const unresolvedP1 = critics.reduce((n,c)=>n+c.unresolvedP1,0);
  const pass = analysis.preReviewVerdict === 'PASS_ANALYSIS_ELIGIBLE_FOR_CRITICS' && unresolvedP0 === 0 && unresolvedP1 === 0 && critics.every(c=>c.verdict==='PASS');
  const summary = { schemaVersion:1, artifactId:'cats-tower-step3-critic-summary', recordedAt:now(), repository:expectedRepo, branch:expectedBranch, reviewTargetCommit:targetCommit, reviewTargetTree:targetTree, criticCount:critics.length, critics:paths.map((p,i)=>({path:p,sha256:fileSha256(p),role:critics[i].role,verdict:critics[i].verdict,unresolvedP0:critics[i].unresolvedP0,unresolvedP1:critics[i].unresolvedP1})), unresolvedP0, unresolvedP1, verdict:pass?'PASS':'FAIL' };
  writeJson(`${step3Dir}/critic-summary.json`,summary);
  const finalJudge = {
    schemaVersion:1, artifactId:'cats-tower-step3-final-judge', recordedAt:now(), repository:expectedRepo, branch:expectedBranch,
    reviewTargetCommit:targetCommit, reviewTargetTree:targetTree,
    acceptance:{path:acceptancePath,blob:blob(acceptancePath)},
    analysis:{path:analysisPath,sha256:fileSha256(analysisPath),verdict:analysis.preReviewVerdict,unresolvedP0:analysis.unresolvedP0,unresolvedP1:analysis.unresolvedP1},
    criticSummary:{path:`${step3Dir}/critic-summary.json`,sha256:fileSha256(`${step3Dir}/critic-summary.json`),criticCount:5,unresolvedP0,unresolvedP1,verdict:summary.verdict},
    candidateMutation:false, holdoutUsedForTuning:false, productionChanged:false, physicalIPhoneVerified:false,
    step3Pass:pass, step4Allowed:false,
    verdict: pass ? 'PASS_STEP3_CONTENT_PENDING_COMPLETION_AND_LIVE_READBACK' : 'FAIL_STEP3_SEALED_CANDIDATE',
    reason: pass ? 'All sealed Step 3 measurements and five independent critic scopes pass. Step 4 remains blocked until completion evidence and terminal live read-back.' : 'One or more sealed-candidate acceptance criteria failed. The failure is preserved; Step 4 remains blocked.'
  };
  writeJson(finalJudgePath,finalJudge);
  terminalStatus(pass ? 'PASS_PENDING_EVIDENCE' : 'FAIL');
  console.log(JSON.stringify({ verdict:finalJudge.verdict, unresolvedP0, unresolvedP1, criticCount:5 }));
}
function terminalStatus(state) {
  const pass = state.startsWith('PASS');
  const acc = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
  acc.status = pass && state === 'PASS_FINAL' ? 'PASS' : state === 'FAIL' ? 'FAIL' : 'IN_PROGRESS';
  acc.verdict = acc.status;
  acc.advanceAllowed = pass && state === 'PASS_FINAL'; acc.step4Allowed = pass && state === 'PASS_FINAL';
  setSequenceStatus(acc, pass && state === 'PASS_FINAL' ? 'PASS' : state === 'FAIL' ? 'FAIL' : 'IN_PROGRESS');
  acc.nextAuthorizedAction = pass && state === 'PASS_FINAL' ? 'Start Step 4 twelve-screen final mockups.' : state === 'FAIL' ? 'Return the failed sealed candidate to change control; Step 4 is blocked.' : 'Create exact completion evidence and terminal live read-back.';
  writeJson('quality-reviews/step-1-canonical-design/active-change-control.json',acc);
  const add = readJson('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json');
  add.status = acc.status; add.verdict = acc.verdict; add.step4Allowed = acc.step4Allowed;
  add.finalJudge = existsSync(path.join(root,finalJudgePath)) ? {path:finalJudgePath,sha256:fileSha256(finalJudgePath),verdict:readJson(finalJudgePath).verdict}:null;
  writeJson('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json',add);
  const policy = readJson('AI_PROJECT_POLICY.json');
  policy.currentPhase.status = acc.status; policy.currentPhase.phase = state === 'FAIL' ? 'SEALED_CANDIDATE_REJECTED' : state === 'PASS_FINAL' ? 'LARGE_SCALE_VALIDATION_COMPLETE' : 'CONTENT_PASS_PENDING_EVIDENCE';
  policy.currentPhase.step4Allowed = acc.step4Allowed; policy.currentPhase.balanceVerdict = state === 'FAIL' ? 'FAIL_STEP3_SEALED_CANDIDATE' : state === 'PASS_FINAL' ? 'PASS_STEP3_LARGE_SCALE_VALIDATION' : 'PASS_PENDING_EVIDENCE';
  writeJson('AI_PROJECT_POLICY.json',policy);
  const project = readJson('PROJECT_STATUS.json');
  project.status = acc.status; project.phase = policy.currentPhase.phase; project.step4Allowed = acc.step4Allowed; project.balanceVerdict = policy.currentPhase.balanceVerdict;
  project.reason = state === 'FAIL' ? 'Step 3 sealed candidate failed one or more acceptance criteria. Step 4 is blocked.' : state === 'PASS_FINAL' ? 'Step 3 large-scale validation, critics, final judge, completion evidence and live read-back passed.' : 'Step 3 measurement and critics passed; completion evidence and live read-back remain pending.';
  project.step3 = {...(project.step3??{}),status:acc.status,analysis:analysisPath,finalJudge:finalJudgePath,completionEvidence:existsSync(path.join(root,completionPath))?'PASS':'PENDING',liveReadback:existsSync(path.join(root,liveReadbackPath))?'PASS':'PENDING'};
  writeJson('PROJECT_STATUS.json',project);
  const simulation=readJson('simulation/CURRENT_STATUS.json');
  simulation.status=acc.status; simulation.phase=policy.currentPhase.phase; simulation.step4Allowed=acc.step4Allowed; simulation.balanceVerdict=policy.currentPhase.balanceVerdict;
  simulation.step3={...(simulation.step3??{}),status:acc.status,gameplayCalibration:'COMPLETE',gameplayHoldout:'COMPLETE_UNSEEN',highVolume:'COMPLETE',critics:'COMPLETE',finalJudge:readJson(finalJudgePath).verdict,completionEvidence:existsSync(path.join(root,completionPath))?'PASS':'PENDING',liveReadback:existsSync(path.join(root,liveReadbackPath))?'PASS':'PENDING'};
  writeJson('simulation/CURRENT_STATUS.json',simulation);
  if (state === 'FAIL' || state === 'PASS_FINAL') for (const p of ['QUALITY_GATE.md','.github/workflows/CURRENT_STATUS.md','AGENTS.md','PROJECT_HANDOVER.md']) updateMarkdownStatus(p,state==='FAIL'?'FAIL':'PASS');
}
function completion() {
  assertExactRepo(); assert(existsSync(path.join(root,finalJudgePath))); assert(!existsSync(path.join(root,completionPath)));
  const contentCommit=git('rev-parse','HEAD'), contentTree=git('rev-parse','HEAD^{tree}');
  const finalJudge=readJson(finalJudgePath);
  const changed=git('diff','--name-only',`${repairBase}..HEAD`).split('\n').filter(Boolean).sort();
  const forbidden=changed.filter(p=>/^(runtime\/|public\/|assets\/|backend\/)/.test(p)||/^simulation\/(candidate-v2|candidate-v2\.schema|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/|executable-seal-v2)/.test(p));
  assert.deepEqual(forbidden,[]);
  const resultPaths=[`${step3Dir}/gameplay-calibration-result.json`,`${step3Dir}/gameplay-holdout-result.json`,...['gacha-tails','pity-conformance','duplicate-skew-overflow','refund-replay-race','state-machine-model','large-number-properties'].map(x=>`${step3Dir}/high-volume/${x}.json`),analysisPath,`${step3Dir}/critic-summary.json`,finalJudgePath];
  const evidence={
    schemaVersion:1,artifactId:'cats-tower-step3-large-scale-validation-completion',recordedAt:now(),repository:expectedRepo,branch:expectedBranch,
    entry:{commit:repairBase,tree:'7499d7b07e5dff59ae5b675b475e23a7e03359b5'},
    acceptance:{path:acceptancePath,blob:blob(acceptancePath)},
    workflow:{path:'.github/workflows/verify-step-3-large-scale-validation.yml',sourceCommit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,jobId:process.env.STEP3_JOB_ID??null,statusAtRecord:'IN_PROGRESS_EXPECTED_SUCCESS'},
    content:{commit:contentCommit,tree:contentTree,changedPaths:changed,forbiddenPaths:forbidden},
    results:Object.fromEntries(resultPaths.map(p=>[p,{blob:blob(p),sha256:fileSha256(p)}])),
    immutable:{step1Seal:{path:'quality-reviews/step-1-reseal-round-008/seal-round-008.json',blob:blob('quality-reviews/step-1-reseal-round-008/seal-round-008.json')},step2Seal:{path:'simulation/executable-seal-v2.json',blob:blob('simulation/executable-seal-v2.json')},governanceReadback:{path:'quality-reviews/step-2-governance-repair-round-001/live-readback.json',blob:blob('quality-reviews/step-2-governance-repair-round-001/live-readback.json')}},
    finalJudge:{path:finalJudgePath,blob:blob(finalJudgePath),verdict:finalJudge.verdict,step3Pass:finalJudge.step3Pass},
    unresolvedP0:readJson(`${step3Dir}/critic-summary.json`).unresolvedP0,unresolvedP1:readJson(`${step3Dir}/critic-summary.json`).unresolvedP1,
    scope:{candidateChanged:false,holdoutUsedForTuning:false,runtimeChanged:false,assetsChanged:false,backendChanged:false,productionChanged:false,physicalIPhoneVerified:false,otherBranchWritten:false,pullRequestOperation:false},
    verdict:'PASS_COMPLETION_EVIDENCE_READY_FOR_TERMINAL_READBACK'
  };
  writeJson(completionPath,evidence);
  console.log(JSON.stringify({verdict:evidence.verdict,contentCommit,contentTree,step3Pass:finalJudge.step3Pass}));
}
function liveReadback() {
  assertExactRepo(); assert(existsSync(path.join(root,completionPath))); assert(!existsSync(path.join(root,liveReadbackPath)));
  const completion=readJson(completionPath); const finalJudge=readJson(finalJudgePath);
  const priorRunId=process.env.PRIOR_RUN_ID; const priorRunConclusion=process.env.PRIOR_RUN_CONCLUSION;
  assert(priorRunId && priorRunConclusion==='success');
  const head=git('rev-parse','HEAD'), tree=git('rev-parse','HEAD^{tree}');
  const mirrors=['quality-reviews/step-1-canonical-design/active-change-control.json','quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json','AI_PROJECT_POLICY.json','QUALITY_GATE.md','.github/workflows/CURRENT_STATUS.md','PROJECT_STATUS.json','simulation/CURRENT_STATUS.json','AGENTS.md','PROJECT_HANDOVER.md'];
  const live={
    schemaVersion:1,artifactId:'cats-tower-step3-large-scale-validation-live-readback',recordedAt:now(),repository:expectedRepo,branch:expectedBranch,
    observedLiveBeforeThisEvidence:{head,tree},
    acceptance:{path:acceptancePath,blob:blob(acceptancePath)},
    completionEvidence:{path:completionPath,blob:blob(completionPath),commit:head,tree,verdict:completion.verdict},
    executionWorkflow:{runId:priorRunId,conclusion:'SUCCESS',sourceCommit:completion.workflow.sourceCommit,jobId:completion.workflow.jobId},
    finalJudge:{path:finalJudgePath,blob:blob(finalJudgePath),verdict:finalJudge.verdict,step3Pass:finalJudge.step3Pass},
    liveMirrorBlobs:Object.fromEntries(mirrors.map(p=>[p,blob(p)])),
    immutableReadback:completion.immutable,
    governanceDecision:{step1:'PASS',step2:'PASS_SEALED',step3:finalJudge.step3Pass?'PASS':'FAIL_SEALED_CANDIDATE',step4:finalJudge.step3Pass?'READY_TO_START':'BLOCKED_BY_STEP3_FAILURE',balanceVerdict:finalJudge.step3Pass?'PASS_STEP3_LARGE_SCALE_VALIDATION':'FAIL_STEP3_SEALED_CANDIDATE',unresolvedP0:completion.unresolvedP0,unresolvedP1:completion.unresolvedP1},
    scopeReadback:{candidateChanged:false,holdoutUsedForTuning:false,runtimeChanged:false,assetsChanged:false,backendChanged:false,paymentProviderChanged:false,adNetworkChanged:false,productionAliasChanged:false,physicalIPhoneVerified:false,otherBranchWritten:false,pullRequestOperationPerformed:false},
    nextAuthorizedAction:finalJudge.step3Pass?'Start Step 4 twelve-screen final mockups.':'Open change control for the failed sealed candidate; Step 4 remains blocked.',
    verdict:finalJudge.step3Pass?'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION':'PASS_FINAL_LIVE_READBACK_STEP3_FAILURE_RECORDED'
  };
  writeJson(liveReadbackPath,live);
  terminalStatus(finalJudge.step3Pass?'PASS_FINAL':'FAIL');
  console.log(JSON.stringify({verdict:live.verdict,step3Pass:finalJudge.step3Pass,priorRunId}));
}
function verifyTerminal() {
  assertExactRepo(); assert(existsSync(path.join(root,completionPath))); assert(existsSync(path.join(root,liveReadbackPath)));
  const live=readJson(liveReadbackPath), completion=readJson(completionPath), finalJudge=readJson(finalJudgePath);
  assert.equal(live.repository,expectedRepo); assert.equal(live.branch,expectedBranch);
  assert.equal(live.completionEvidence.blob,blob(completionPath)); assert.equal(live.finalJudge.blob,blob(finalJudgePath));
  assert.equal(live.finalJudge.step3Pass,finalJudge.step3Pass); assert.equal(completion.finalJudge.step3Pass,finalJudge.step3Pass);
  assert.equal(live.scopeReadback.productionAliasChanged,false); assert.equal(live.scopeReadback.physicalIPhoneVerified,false); assert.equal(live.scopeReadback.holdoutUsedForTuning,false);
  const status=readJson('PROJECT_STATUS.json'); assert.equal(Boolean(status.step4Allowed),Boolean(finalJudge.step3Pass));
  console.log(JSON.stringify({verdict:'PASS_STEP3_TERMINAL_EVIDENCE_VERIFICATION',head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),step3Pass:finalJudge.step3Pass,liveReadbackVerdict:live.verdict}));
}

switch(mode){case'activate':activate();break;case'review':review();break;case'completion':completion();break;case'live-readback':liveReadback();break;case'verify-terminal':verifyTerminal();break;default:throw new Error(`Unknown mode: ${mode}`);}
