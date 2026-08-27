#!/usr/bin/env node
import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { gitBlobSha, sha256Text } from './engine-v2/hash.mjs';

const root=resolve('.');
const report={schemaVersion:'2.0.0',verificationId:'cats-tower-step2-v2-verification',runtimeVersion:process.version,sourceReadbackMode:process.env.CT_DEV_SOURCE_MANIFEST_ONLY==='1'?'DEVELOPMENT_MANIFEST_ONLY':'FULL_GIT_BLOB_READBACK',checks:[],verdict:'PENDING'};
const fail=(name,detail)=>{report.checks.push({name,status:'FAIL',detail});};
const pass=(name,detail)=>{report.checks.push({name,status:'PASS',detail});};

async function exists(path){try{await access(resolve(path));return true;}catch{return false;}}
async function verifyLegacyLock(){
  const lock=JSON.parse(await readFile(resolve('simulation/legacy-v1-lock.json'),'utf8'));
  const mismatches=[];
  const development=process.env.CT_DEV_SOURCE_MANIFEST_ONLY==='1';
  let developmentSkipped=0;
  for(const entry of lock.files){
    try{const actual=gitBlobSha(await readFile(resolve(entry.path)));if(actual!==entry.gitBlob)mismatches.push({path:entry.path,expected:entry.gitBlob,actual});}
    catch(error){if(development)developmentSkipped+=1;else mismatches.push({path:entry.path,error:error.message});}
  }
  if(lock.mayExecuteForV2Promotion||lock.mayExtendInPlace||lock.mayReuseObservedHoldout)mismatches.push({path:'lock',error:'legacy disposition permits forbidden reuse'});
  if(mismatches.length)fail('legacy-v1-byte-lock',mismatches);else pass('legacy-v1-byte-lock',{files:String(lock.files.length),disposition:lock.disposition,developmentSkipped:String(developmentSkipped)});
}
function run(name,args,env={}){
  const child=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...process.env,...env},timeout:180000,maxBuffer:20*1024*1024});
  const detail={command:`node ${args.join(' ')}`,exitCode:child.status,stdoutSha256:sha256Text(child.stdout??''),stderrSha256:sha256Text(child.stderr??''),stdout:(child.stdout??'').trim().slice(-1000),stderr:(child.stderr??'').trim().slice(-2000)};
  if(child.status===0)pass(name,detail);else fail(name,detail);
  return child;
}

const required=[
  'simulation/candidate-v2.json','simulation/candidate-v2.schema.json','simulation/validate-candidate-v2.mjs','simulation/run-plan-v2.json','simulation/result-v2.schema.json','simulation/validate-result-v2.mjs',
  'simulation/engine-v2/index.mjs','simulation/engine-v2/numeric.mjs','simulation/engine-v2/rng.mjs','simulation/engine-v2/tower.mjs','simulation/engine-v2/economy.mjs','simulation/engine-v2/state-machines.mjs','simulation/engine-v2/hash.mjs','simulation/engine-v2/run-scenario.mjs','simulation/engine-v2/run-plan.mjs',
  'simulation/fixtures/v2/manifest.json','simulation/fixtures/v2/positive.json','simulation/fixtures/v2/boundary.json','simulation/fixtures/v2/negative.json','simulation/fixtures/v2/state-transitions.json','simulation/fixtures/v2/cross-runtime-golden.json','simulation/fixtures/v2/validate-fixtures.mjs',
  'simulation/migrations/v1-to-v2/migration-map.json','simulation/migrations/v1-to-v2/migrate.mjs','simulation/migrations/v1-to-v2/fixtures.json','simulation/migrations/v1-to-v2/validate-migration.mjs',
  'quality-reviews/step-2-executable-contract-v2/qualification-result.json'
];
const missing=[];for(const path of required)if(!(await exists(path)))missing.push(path);
if(missing.length)fail('required-content-paths',missing);else pass('required-content-paths',{count:String(required.length)});
await verifyLegacyLock();
const sourceEnv=process.env.CT_DEV_SOURCE_MANIFEST_ONLY==='1'?{CT_DEV_SOURCE_MANIFEST_ONLY:'1'}:{};
run('candidate-schema-and-semantics',['simulation/validate-candidate-v2.mjs'],sourceEnv);
run('positive-boundary-negative-state-golden-fixtures',['simulation/fixtures/v2/validate-fixtures.mjs'],sourceEnv);
run('v1-to-v2-migration',['simulation/migrations/v1-to-v2/validate-migration.mjs']);
run('committed-result-schema-and-reproduction',['simulation/validate-result-v2.mjs','quality-reviews/step-2-executable-contract-v2/qualification-result.json','--reproduce']);

const temp=await mkdtemp(join(tmpdir(),'cats-tower-step2-rerun-'));
try{
  const output=join(temp,'qualification.json');
  const generated=run('engine-qualification-rerun',['simulation/engine-v2/run-plan.mjs','--mode','qualification','--output',output]);
  if(generated.status===0){
    const committed=JSON.parse(await readFile(resolve('quality-reviews/step-2-executable-contract-v2/qualification-result.json'),'utf8'));
    const rerun=JSON.parse(await readFile(output,'utf8'));
    if(committed.hashes.deterministicPayloadSha256===rerun.hashes.deterministicPayloadSha256&&JSON.stringify(committed.deterministicPayload)===JSON.stringify(rerun.deterministicPayload))pass('qualification-byte-determinism',{digest:rerun.hashes.deterministicPayloadSha256});
    else fail('qualification-byte-determinism',{committed:committed.hashes.deterministicPayloadSha256,rerun:rerun.hashes.deterministicPayloadSha256});
  }
}finally{await rm(temp,{recursive:true,force:true});}

if(await exists('simulation/executable-seal-v2.json'))run('executable-seal-v2',['simulation/validate-executable-seal-v2.mjs']);
else report.checks.push({name:'executable-seal-v2',status:'NOT_PRESENT_CONTENT_PHASE',detail:'Step 2 remains IN_PROGRESS; this result cannot authorize Step 3.'});

const failed=report.checks.filter((x)=>x.status==='FAIL');
report.verdict=failed.length?'FAIL':(report.checks.some((x)=>x.status==='NOT_PRESENT_CONTENT_PHASE')?'CONTENT_PHASE_PASS_STEP2_IN_PROGRESS':'PASS');
console.log(JSON.stringify(report,null,2));
if(failed.length)process.exit(1);
