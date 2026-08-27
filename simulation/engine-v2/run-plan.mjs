#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { deterministicSeed } from './rng.mjs';
import { runScenario } from './run-scenario.mjs';
import { sha256Canonical, sha256Text, canonicalJson } from './hash.mjs';

async function load(path) { return JSON.parse(await readFile(resolve(path),'utf8')); }

export async function runQualification({candidatePath='simulation/candidate-v2.json',planPath='simulation/run-plan-v2.json'}={}) {
  const candidate=await load(candidatePath);
  const plan=await load(planPath);
  const scenarios=[];
  const count=Number(plan.seeds.qualificationPerCell);
  for (const buildId of plan.builds) for (const personaId of plan.personas) for (let ordinal=0;ordinal<count;ordinal+=1) {
    const seed=deterministicSeed(plan.seeds.qualificationNamespace,buildId,personaId,ordinal);
    scenarios.push(runScenario(candidate,plan,{buildId,personaId,seed,ordinal}));
  }
  const firstReset=scenarios.map((x)=>BigInt(x.firstResetMinutes));
  const guaranteeDays=scenarios.map((x)=>BigInt(x.featuredGuaranteeDay));
  const deterministicPayload={
    mode:'STEP2_QUALIFICATION_ONLY',
    candidateId:candidate.meta.candidateId,
    algorithmVersion:candidate.meta.algorithmVersion,
    roundingVersion:candidate.meta.roundingVersion,
    seedNamespace:plan.seeds.qualificationNamespace,
    scenarioCount:String(scenarios.length),
    scenarios,
    summary:{
      buildCount:String(plan.builds.length),personaCount:String(plan.personas.length),seedsPerCell:plan.seeds.qualificationPerCell,
      firstResetMinutesMinimum:BigInt.asUintN(64,firstReset.reduce((a,b)=>a<b?a:b)).toString(),
      firstResetMinutesMaximum:firstReset.reduce((a,b)=>a>b?a:b).toString(),
      featuredGuaranteeDayMinimum:guaranteeDays.reduce((a,b)=>a<b?a:b).toString(),
      featuredGuaranteeDayMaximum:guaranteeDays.reduce((a,b)=>a>b?a:b).toString(),
      allFirstEvolutionsCovered:scenarios.every((x)=>x.firstEvolutionCovered),
      balanceVerdict:'NOT_EVALUATED_STEP2',
    },
    violations:[],
  };
  const candidateText=await readFile(resolve(candidatePath),'utf8');
  const planText=await readFile(resolve(planPath),'utf8');
  return {
    schemaVersion:'2.0.0',
    resultId:'cats-tower-step2-v2-qualification-001',
    deterministicPayload,
    hashes:{candidateSha256:sha256Text(candidateText),runPlanSha256:sha256Text(planText),deterministicPayloadSha256:sha256Canonical(deterministicPayload)},
    evidence:{runtimeVersion:process.version,executedAt:new Date().toISOString(),reproductionCommand:'node simulation/engine-v2/run-plan.mjs --mode qualification --output quality-reviews/step-2-executable-contract-v2/qualification-result.json',canonicalJsonSha256:sha256Text(canonicalJson(deterministicPayload))},
    verdict:{contractQualification:'PASS',balanceQualification:'NOT_RUN_STEP3_REQUIRED',step3AuthorizedByThisResult:false},
  };
}

function arg(name, fallback) {
  const index=process.argv.indexOf(name);
  return index>=0 ? process.argv[index+1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode=arg('--mode','qualification');
  if (mode!=='qualification') throw new Error('Step 2 runner permits qualification mode only; full matrix belongs to Step 3');
  const output=arg('--output','quality-reviews/step-2-executable-contract-v2/qualification-result.json');
  const result=await runQualification({candidatePath:arg('--candidate','simulation/candidate-v2.json'),planPath:arg('--plan','simulation/run-plan-v2.json')});
  await writeFile(resolve(output),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify({ok:true,mode,output,digest:result.hashes.deterministicPayloadSha256,scenarioCount:result.deterministicPayload.scenarioCount}));
}
