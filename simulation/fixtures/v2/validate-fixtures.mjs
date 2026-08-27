#!/usr/bin/env node
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { sha256Text, canonicalJson } from '../../engine-v2/hash.mjs';
import { addUnsigned, subtractUnsigned, multiplyUnsigned, divideUnsigned, roundRational, rational, displayAbbreviation, toBigInt } from '../../engine-v2/numeric.mjs';
import { assertProbabilityTable, resetRubyQuote, evolutionEligibility, masteryOverflow, applyPaidRubyRefund, pityOutcome, pityCarryoverOutcome } from '../../engine-v2/economy.mjs';
import { generateFloor, isCanonicalDistrictId, isCanonicalCycleId, isCanonicalMilestoneId } from '../../engine-v2/tower.mjs';
import { replaySequence, idempotentResult, exactlyOnceReceipt, acceptedVersionRetry, loginClaimDecision } from '../../engine-v2/state-machines.mjs';

const load=async(path)=>JSON.parse(await readFile(resolve(path),'utf8'));
const candidate=await load('simulation/candidate-v2.json');
const manifest=await load('simulation/fixtures/v2/manifest.json');
const positive=await load('simulation/fixtures/v2/positive.json');
const boundary=await load('simulation/fixtures/v2/boundary.json');
const negative=await load('simulation/fixtures/v2/negative.json');
const state=await load('simulation/fixtures/v2/state-transitions.json');
const golden=await load('simulation/fixtures/v2/cross-runtime-golden.json');
const runPlanNegative=await load('simulation/fixtures/v2/run-plan-negative.json');
const errors=[];
const check=(condition,code,message)=>{if(!condition)errors.push({code,message});};

for(const entry of manifest.files){
  const text=await readFile(resolve(entry.path),'utf8');
  check(sha256Text(text)===entry.sha256,'MANIFEST_DIGEST',entry.path);
  check(Buffer.byteLength(text,'utf8').toString()===entry.bytes,'MANIFEST_BYTES',entry.path);
}
check(negative.cases.length.toString()===negative.caseCount,'NEGATIVE_COUNT','negative case count mismatch');
check(runPlanNegative.cases.length.toString()===runPlanNegative.caseCount,'RUN_PLAN_NEGATIVE_COUNT','run-plan negative case count mismatch');
check(manifest.negativeCoverage.allRequiredFamiliesCovered===true,'NEGATIVE_COVERAGE','manifest does not assert full family coverage');

for(const test of positive.cases){
  try{
    if(test.kind==='numeric'){
      let actual;
      if(test.operation==='addUnsigned') actual=addUnsigned(...test.input);
      else if(test.operation==='halfEven') actual=roundRational(rational(BigInt(test.input.numerator),BigInt(test.input.denominator)),'half-even').toString();
      else throw new Error(`unknown numeric op ${test.operation}`);
      check(actual===test.expected,'POSITIVE_NUMERIC',`${test.id}:${actual}`);
    }else if(test.kind==='probability'){
      const table=candidate.gacha.rates.find((x)=>x.id===test.table); assertProbabilityTable(table.entries);
    }else if(test.kind==='tower'){
      const floor=generateFloor(candidate,test.floor);check(floor.districtId===test.expectedDistrictId&&floor.cycleId===test.expectedCycleId,'POSITIVE_TOWER',test.id);
    }else if(test.kind==='reset'){
      const q=resetRubyQuote({previousBest:test.previousBest,newBest:test.newBest,firstEffectiveMinimum:candidate.reset.reward.firstEffectiveMinimum});
      check(q.eligible===test.expectedEligible,'POSITIVE_RESET',`${test.id}:eligible`);
      if(test.expectedReward!==undefined)check(q.reward===test.expectedReward,'POSITIVE_RESET',`${test.id}:reward`);
      if(test.minimumReward!==undefined)check(toBigInt(q.reward)>=toBigInt(test.minimumReward),'POSITIVE_RESET',`${test.id}:minimum`);
    }else if(test.kind==='evolution'){
      const e=evolutionEligibility(test.level,test.purchasedStages);check(e.nextMissingStage===test.expectedNextMissingStage&&e.levelContinuationBlocked===test.expectedBlocked,'POSITIVE_EVOLUTION',test.id);
    }else if(test.kind==='mastery'){
      const m=masteryOverflow(candidate.characterMastery,test.copies);check(m.masteredCopies===test.expectedMasteredCopies&&m.overflowCopies===test.expectedOverflowCopies&&m.overflowCredit===test.expectedOverflowCredit,'POSITIVE_MASTERY',test.id);
    }else if(test.kind==='refund'){
      const r=applyPaidRubyRefund({...test,transactionId:'transaction.payment.fixture',policyVersion:'refund-deficit-v2'});check(r.state===test.expectedState&&r.deficit.magnitude===test.expectedMagnitude&&r.freeLedgersDebited===test.expectedFreeLedgersDebited,'POSITIVE_REFUND',test.id);
    }else if(test.kind==='pity'){
      const p=pityOutcome({...test,hardPity:candidate.gacha.hardPity.draws,featuredGuarantee:candidate.gacha.featuredGuarantee.draws});
      if(test.expectedRarity)check(p.rarity===test.expectedRarity,'POSITIVE_PITY',`${test.id}:rarity`);
      if(test.expectedHardPity!==undefined)check(p.hardPityTriggered===test.expectedHardPity,'POSITIVE_PITY',`${test.id}:hard`);
      if(test.expectedFeatured!==undefined)check(p.featured===test.expectedFeatured,'POSITIVE_PITY',`${test.id}:featured`);
      if(test.expectedGuarantee!==undefined)check(p.featuredGuaranteeTriggered===test.expectedGuarantee,'POSITIVE_PITY',`${test.id}:guarantee`);
    }
  }catch(error){errors.push({code:'POSITIVE_THROW',message:`${test.id}:${error.message}`});}
}

for(const test of boundary.towerCases){
  const floor=generateFloor(candidate,test.floor);
  check(floor.districtId===test.expectedDistrictId,'BOUNDARY_DISTRICT',`${test.floor}:${floor.districtId}`);
  check(floor.cycleId===test.expectedCycleId,'BOUNDARY_CYCLE',`${test.floor}:${floor.cycleId}`);
  check(floor.boss.id===test.expectedBossId,'BOUNDARY_BOSS',`${test.floor}:${floor.boss.id}`);
  check(floor.hp.representation===test.expectedHpRepresentation,'BOUNDARY_REPRESENTATION',`${test.floor}:${floor.hp.representation}`);
}
for(const test of boundary.idCases){
  const actual=test.kind==='district'?isCanonicalDistrictId(test.id):test.kind==='cycle'?isCanonicalCycleId(test.id):isCanonicalMilestoneId(test.id);
  check(actual===test.canonical,'BOUNDARY_ID',test.id);
}
for(const test of boundary.pityCases){
  const actual=pityOutcome({...test,hardPity:candidate.gacha.hardPity.draws,featuredGuarantee:candidate.gacha.featuredGuarantee.draws});
  check(actual.hardPityTriggered===test.hardPityTriggered&&actual.featuredGuaranteeTriggered===test.featuredGuaranteeTriggered,'BOUNDARY_PITY',JSON.stringify(test));
  if(test.expectedRarity!==undefined)check(actual.rarity===test.expectedRarity,'BOUNDARY_PITY_RARITY',JSON.stringify(test));
  if(test.expectedFeatured!==undefined)check(actual.featured===test.expectedFeatured,'BOUNDARY_PITY_FEATURED',JSON.stringify(test));
}
for(const test of boundary.carryoverCases??[]){
  const actual=pityCarryoverOutcome(candidate,test);
  check(actual.compatible===test.expectedCompatible,'BOUNDARY_CARRYOVER_COMPATIBILITY',test.id);
  check(actual.outcome===test.expectedOutcome,'BOUNDARY_CARRYOVER_OUTCOME',test.id);
  check(actual.targetDrawsSinceUR===test.expectedTargetDrawsSinceUR&&actual.targetFeaturedProgress===test.expectedTargetFeaturedProgress,'BOUNDARY_CARRYOVER_TARGET',test.id);
  check(actual.sourceProgressRetained===test.expectedSourceProgressRetained,'BOUNDARY_CARRYOVER_SOURCE',test.id);
}
for(const test of boundary.refundCases??[]){
  let rejected=false;
  try{applyPaidRubyRefund({...test,transactionId:'transaction.payment.fixture',policyVersion:'refund-deficit-v2'});}catch(error){rejected=error.message.includes(test.expectedError);}
  check(rejected,'BOUNDARY_REFUND_REJECTION',test.id);
}
for(const test of boundary.evolutionCases){
  const actual=evolutionEligibility(test.level,test.purchasedStages);
  check(actual.eligibleStages===test.eligibleStages&&actual.nextMissingStage===test.nextMissingStage&&!actual.levelContinuationBlocked,'BOUNDARY_EVOLUTION',JSON.stringify(test));
}
for(const test of boundary.resetCases){
  const actual=resetRubyQuote({previousBest:test.previousBest,newBest:test.newBest,firstEffectiveMinimum:candidate.reset.reward.firstEffectiveMinimum});
  check(actual.eligible===test.eligible,'BOUNDARY_RESET',JSON.stringify(test));
  if(test.reward!==undefined)check(actual.reward===test.reward,'BOUNDARY_RESET_REWARD',JSON.stringify(test));
  if(test.minimumReward!==undefined)check(toBigInt(actual.reward)>=toBigInt(test.minimumReward),'BOUNDARY_RESET_MINIMUM',JSON.stringify(test));
}

for(const test of state.successSequences){try{replaySequence(test.machineId,test.states);}catch(error){errors.push({code:'STATE_SUCCESS',message:`${test.id}:${error.message}`});}}
for(const test of state.invalidSequences){let failed=false;try{replaySequence(test.machineId,test.states);}catch(error){failed=error.message.includes(test.expectedError);}check(failed,'STATE_NEGATIVE',test.id);}
for(const test of state.idempotencyCases){
  if(test.receiptId){const store=new Map();let grants=0;exactlyOnceReceipt(store,test.receiptId,++grants);exactlyOnceReceipt(store,test.receiptId,++grants);check(store.size.toString()===test.expectedGrantCount,'RECEIPT_ONCE',test.id);}
  else {const store=new Map();let operations=0;idempotentResult(store,test.key,()=>({n:++operations}));idempotentResult(store,test.key,()=>({n:++operations}));check(operations.toString()===test.expectedOperationCount,'IDEMPOTENCY_ONCE',test.id);}
}
for(const test of state.versionCases){const actual=acceptedVersionRetry(test);check(actual.outcome===test.expected,'VERSION_BINDING',test.id);}
for(const test of state.loginPeriodCases??[]){
  const actual=loginClaimDecision(test.input);
  check(actual.outcome===test.expectedOutcome&&actual.nextTrackIndex===test.expectedNextTrackIndex,'LOGIN_PERIOD_OUTCOME',test.id);
  check(actual.serverTimeAuthoritative===true&&actual.missedDayResetsTrack===false,'LOGIN_PERIOD_AUTHORITY',test.id);
}

for(const test of golden.numeric){
  let actual;
  if(test.operation==='addUnsigned')actual=addUnsigned(...test.input);
  else if(test.operation==='subtractUnsigned')actual=subtractUnsigned(...test.input);
  else if(test.operation==='multiplyUnsigned')actual=multiplyUnsigned(...test.input);
  else if(test.operation==='divideUnsigned')actual=divideUnsigned(...test.input);
  else if(test.operation==='halfEven')actual=roundRational(rational(BigInt(test.input[0]),BigInt(test.input[1])),'half-even').toString();
  check(actual===test.expected,'GOLDEN_NUMERIC',`${test.id}:${actual}`);
}
for(const test of golden.canonicalJson){check(canonicalJson(test.input)===test.canonical&&sha256Text(test.canonical)===test.sha256,'GOLDEN_CANONICAL_JSON',JSON.stringify(test.input));}
for(const test of golden.displayInternalSeparation){check(displayAbbreviation(test.internal)===test.display&&test.displayIsSourceOfTruth===false,'DISPLAY_INTERNAL',test.internal);}

function decodePointer(path){return path.split('/').slice(1).map((x)=>x.replace(/~1/g,'/').replace(/~0/g,'~'));}
function mutate(base,mutation){
  const copy=structuredClone(base);const parts=decodePointer(mutation.path);let node=copy;
  for(let i=0;i<parts.length-1;i+=1)node=node[Array.isArray(node)?Number(parts[i]):parts[i]];
  const key=parts.at(-1);
  if(mutation.op==='set')node[Array.isArray(node)?Number(key):key]=mutation.value;
  else if(mutation.op==='delete'){if(Array.isArray(node))node.splice(Number(key),1);else delete node[key];}
  else throw new Error(`unknown mutation ${mutation.op}`);
  return copy;
}

const temp=await mkdtemp(join(tmpdir(),'cats-tower-v2-negative-'));
try{
  for(const test of negative.cases){
    const path=join(temp,`candidate-${test.id}.json`);await writeFile(path,JSON.stringify(mutate(candidate,test.mutation),null,2)+'\n','utf8');
    const run=spawnSync(process.execPath,['simulation/validate-candidate-v2.mjs',path,'--development-source-manifest-only'],{cwd:resolve('.'),encoding:'utf8',timeout:30000});
    check(run.status!==0,'NEGATIVE_ACCEPTED',test.id);
    check(test.expectedCodes.some((code)=>run.stderr.includes(`"code": "${code}"`)||run.stderr.includes(`"code":"${code}"`)),'NEGATIVE_WRONG_REASON',`${test.id}:${test.expectedCodes.join('|')}:${run.stderr.slice(0,300)}`);
  }
  const runPlan=await load('simulation/run-plan-v2.json');
  for(const test of runPlanNegative.cases){
    const path=join(temp,`run-plan-${test.id}.json`);await writeFile(path,JSON.stringify(mutate(runPlan,test.mutation),null,2)+'\n','utf8');
    const run=spawnSync(process.execPath,['simulation/validate-run-plan-v2.mjs',path],{cwd:resolve('.'),encoding:'utf8',timeout:30000});
    check(run.status!==0,'RUN_PLAN_NEGATIVE_ACCEPTED',test.id);
    check(test.expectedCodes.some((code)=>run.stderr.includes(`"code": "${code}"`)||run.stderr.includes(`"code":"${code}"`)),'RUN_PLAN_NEGATIVE_WRONG_REASON',`${test.id}:${test.expectedCodes.join('|')}:${run.stderr.slice(0,300)}`);
  }
}finally{await rm(temp,{recursive:true,force:true});}

if(errors.length){console.error(JSON.stringify({ok:false,errorCount:errors.length,errors},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,fixtureFiles:manifest.files.length,positiveCases:positive.cases.length,boundaryTowerCases:boundary.towerCases.length,boundaryPityCases:boundary.pityCases.length,boundaryCarryoverCases:(boundary.carryoverCases??[]).length,negativeCases:negative.cases.length,stateSuccessCases:state.successSequences.length,stateInvalidCases:state.invalidSequences.length,loginPeriodCases:(state.loginPeriodCases??[]).length,goldenNumericCases:golden.numeric.length,runPlanNegativeCases:runPlanNegative.cases.length}));
