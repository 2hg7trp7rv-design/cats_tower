#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';
import { sha256Canonical, sha256Text } from './engine-v2/hash.mjs';
import { runQualification } from './engine-v2/run-plan.mjs';

const resultPath=resolve(process.argv[2] ?? 'quality-reviews/step-2-executable-contract-v2/qualification-result.json');
const schema=JSON.parse(await readFile(resolve('simulation/result-v2.schema.json'),'utf8'));
const result=JSON.parse(await readFile(resultPath,'utf8'));
const errors=[];
const check=(condition,code,message)=>{if(!condition)errors.push({code,message});};
try { assertSchema(result,schema); } catch(error) { for(const e of error.errors??[]) errors.push({code:'SCHEMA',message:`${e.path} ${e.keyword}: ${e.message}`}); }

const candidateText=await readFile(resolve('simulation/candidate-v2.json'),'utf8');
const planText=await readFile(resolve('simulation/run-plan-v2.json'),'utf8');
check(result.hashes.candidateSha256===sha256Text(candidateText),'CANDIDATE_DIGEST','candidate digest mismatch');
check(result.hashes.runPlanSha256===sha256Text(planText),'RUN_PLAN_DIGEST','run-plan digest mismatch');
check(result.hashes.deterministicPayloadSha256===sha256Canonical(result.deterministicPayload),'PAYLOAD_DIGEST','deterministic payload digest mismatch');
check(result.evidence.canonicalJsonSha256===result.hashes.deterministicPayloadSha256,'CANONICAL_DIGEST','canonical JSON digest mismatch');

const scenarios=result.deterministicPayload.scenarios;
check(BigInt(result.deterministicPayload.scenarioCount)===BigInt(scenarios.length),'SCENARIO_COUNT','scenario count field mismatch');
check(scenarios.length===30,'QUALIFICATION_MATRIX','qualification must contain 3x5x2=30 scenarios');
check(new Set(scenarios.map((x)=>x.scenarioId)).size===scenarios.length,'SCENARIO_ID','scenario IDs are not unique');
for(const scenario of scenarios){
  const {scenarioDigest,...payload}=scenario;
  check(scenarioDigest===sha256Canonical(payload),'SCENARIO_DIGEST',scenario.scenarioId);
  const minutes=BigInt(scenario.firstResetMinutes);
  check(minutes>=20n&&minutes<=35n,'FIRST_RESET_WINDOW',`${scenario.scenarioId}=${minutes}`);
  check(scenario.firstEvolutionCovered===true,'FIRST_EVOLUTION_COVERAGE',scenario.scenarioId);
  check(scenario.masteryAt20.masteredCopies==='20'&&scenario.masteryAt20.overflowCopies==='0','MASTERY_20',scenario.scenarioId);
  check(scenario.masteryOverflowAt25.masteredCopies==='20'&&scenario.masteryOverflowAt25.overflowCopies==='5'&&scenario.masteryOverflowAt25.overflowCredit==='500','MASTERY_OVERFLOW',scenario.scenarioId);
  const horizonIds=scenario.horizons.map((x)=>x.horizonId);
  check(JSON.stringify(horizonIds)===JSON.stringify(['1-10F','100F','1000F','10000F-or-equivalent','repeated-resets','30-45-day-economy']),'HORIZONS',scenario.scenarioId);
  const floor10000=scenario.horizons.find((x)=>x.horizonId==='10000F-or-equivalent');
  check(floor10000?.targetFloorRepresentation==='exact-symbolic-power','LARGE_FLOOR_REPRESENTATION',scenario.scenarioId);
  if(scenario.personaId==='no-ad-f2p'){
    const day=BigInt(scenario.featuredGuaranteeDay);
    check(day>=30n&&day<=45n,'NO_AD_FEATURED_WINDOW',`${scenario.scenarioId}=${day}`);
  }
}

const expectedCells=new Set();
for(const build of ['build.combat','build.reinforcement','build.commerce']) for(const persona of ['no-ad-f2p','rewarded-ad-f2p','monthly-pass','controlled-payer','high-spend-stress']) for(const ordinal of ['0','1']) expectedCells.add(`${build}|${persona}|${ordinal}`);
for(const scenario of scenarios) expectedCells.delete(`${scenario.buildId}|${scenario.personaId}|${scenario.ordinal}`);
check(expectedCells.size===0,'MATRIX_COVERAGE',`missing ${[...expectedCells].join(',')}`);
check(result.deterministicPayload.summary.balanceVerdict==='NOT_EVALUATED_STEP2','BALANCE_SCOPE','Step 2 issued a balance verdict');
check(result.verdict.step3AuthorizedByThisResult===false,'STEP3_SCOPE','qualification result improperly authorizes Step 3');
check(result.deterministicPayload.violations.length===0,'VIOLATIONS','qualification contains violations');

if(process.argv.includes('--reproduce')){
  const rerun=await runQualification();
  check(rerun.hashes.deterministicPayloadSha256===result.hashes.deterministicPayloadSha256,'REPRODUCTION','rerun digest differs');
  check(JSON.stringify(rerun.deterministicPayload)===JSON.stringify(result.deterministicPayload),'BYTE_REPRODUCTION','normalized deterministic payload differs');
}

if(errors.length){console.error(JSON.stringify({ok:false,result:resultPath,errorCount:errors.length,errors},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,result:resultPath,scenarioCount:String(scenarios.length),digest:result.hashes.deterministicPayloadSha256,reproduced:process.argv.includes('--reproduce'),balanceVerdict:'NOT_EVALUATED_STEP2'}));
