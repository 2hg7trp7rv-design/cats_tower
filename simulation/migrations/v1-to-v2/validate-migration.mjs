#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { migrateV1ToV2, migrationMap } from './migrate.mjs';
import { sha256Text } from '../../engine-v2/hash.mjs';

const fixtures=JSON.parse(await readFile(resolve('simulation/migrations/v1-to-v2/fixtures.json'),'utf8'));
const errors=[];const check=(c,code,message)=>{if(!c)errors.push({code,message});};
check(migrationMap.invariants.rawBackupImmutable&&migrationMap.invariants.idempotentMarker&&migrationMap.invariants.unknownIdFailsClosed&&migrationMap.invariants.conflictingOwnershipFailsClosed&&migrationMap.invariants.aliasesNeverWritten&&migrationMap.invariants.parallelDawnResetForbidden,'MAP_INVARIANTS','migration map invariants incomplete');
for(const test of fixtures.positive){
  try{
    const output=migrateV1ToV2(test.input);const again=migrateV1ToV2(output);
    check(JSON.stringify(output)===JSON.stringify(again),'IDEMPOTENCE',test.id);
    check(output.reset.id===test.expected.resetId,'RESET',test.id);
    check(JSON.stringify(output.ownership.characters.map((x)=>x.id))===JSON.stringify(test.expected.characterIds),'CHARACTERS',test.id);
    check(JSON.stringify(output.ownership.shops.map((x)=>x.id))===JSON.stringify(test.expected.shopIds),'SHOPS',test.id);
    check(output.wallet['wallet.ruby.paid']===test.expected.paidRuby,'PAID',test.id);
    check(output.wallet['wallet.ruby.free.reset']===test.expected.freeResetRuby,'FREE_RESET',test.id);
    check(output.provenance.find((x)=>x.source==='currency.dawn_shard').amount===test.expected.dawnProvenance,'PROVENANCE',test.id);
    check(sha256Text(output.migration.rawBackup)===output.migration.rawBackupSha256,'RAW_BACKUP_DIGEST',test.id);
    check(!JSON.stringify(output).includes('"dawn"'),'ALIAS_OUTPUT',test.id);
  }catch(error){errors.push({code:'POSITIVE_THROW',message:`${test.id}:${error.message}`});}
}
for(const test of fixtures.negative){let rejected=false;try{migrateV1ToV2(test.input);}catch(error){rejected=error.message.includes(test.expectedError);}check(rejected,'NEGATIVE_NOT_REJECTED',test.id);}
if(errors.length){console.error(JSON.stringify({ok:false,errorCount:errors.length,errors},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,migrationId:migrationMap.migrationId,positive:fixtures.positive.length,negative:fixtures.negative.length,idempotent:true,rawBackup:true}));
