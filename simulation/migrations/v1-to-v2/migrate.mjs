import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson, sha256Text } from '../../engine-v2/hash.mjs';
import { assertUnsigned, addUnsigned } from '../../engine-v2/numeric.mjs';

const map=JSON.parse(await readFile(resolve('simulation/migrations/v1-to-v2/migration-map.json'),'utf8'));

function canonicalize(id, domain) {
  const candidate=map.aliases[id] ?? id;
  const pattern=new RegExp(map.canonicalPatterns[domain]);
  if(!pattern.test(candidate)) throw new Error(`UNKNOWN_OR_INVALID_${domain.toUpperCase()}_ID:${id}`);
  return candidate;
}

function normalizeOwnership(entries, domain) {
  const out=new Map();
  for(const entry of entries??[]){
    const id=canonicalize(entry.id,domain);
    const copies=assertUnsigned(entry.copies??'1',`${domain}.${id}.copies`);
    if(out.has(id)&&out.get(id)!==copies) throw new Error(`CONFLICTING_OWNERSHIP:${id}`);
    out.set(id,copies);
  }
  return [...out.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([id,copies])=>({id,copies}));
}

export function migrateV1ToV2(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('LEGACY_INPUT_OBJECT_REQUIRED');
  if(input.migration?.version===map.migrationId){
    if(!input.migration.rawBackup||!input.migration.rawBackupSha256) throw new Error('MIGRATION_MARKER_WITHOUT_RAW_BACKUP');
    return structuredClone(input);
  }
  const raw=canonicalJson(input);
  const resetSource=input.resetId??input.dawn?.resetId??'dawn';
  const resetId=canonicalize(resetSource,'reset');
  if(resetId!=='reset.tower_return') throw new Error('PARALLEL_RESET_FORBIDDEN');
  const paid=assertUnsigned(input.wallet?.paidRuby??'0','wallet.paidRuby');
  const freeResetExisting=assertUnsigned(input.wallet?.freeResetRuby??'0','wallet.freeResetRuby');
  const dawn=assertUnsigned(input.wallet?.dawnShard??input.dawn?.currency??'0','wallet.dawnShard');
  const output={
    schemaVersion:'2.0.0',
    profileId:String(input.profileId??'legacy-unknown'),
    ownership:{
      characters:normalizeOwnership(input.characters,'character'),
      weapons:normalizeOwnership(input.weapons,'weapon'),
      shops:normalizeOwnership(input.shops,'shop'),
    },
    reset:{id:'reset.tower_return',highestFloor:assertUnsigned(input.highestFloor??'1','highestFloor')},
    wallet:{
      'wallet.ruby.paid':paid,
      'wallet.ruby.free.reset':addUnsigned(freeResetExisting,dawn),
      'wallet.ruby.free.ad':assertUnsigned(input.wallet?.freeAdRuby??'0','wallet.freeAdRuby'),
      'wallet.ruby.free.other':assertUnsigned(input.wallet?.freeOtherRuby??'0','wallet.freeOtherRuby'),
    },
    provenance:[
      {source:'legacy.wallet.paidRuby',target:'wallet.ruby.paid',amount:paid,auditRequired:true},
      {source:'currency.dawn_shard',target:'wallet.ruby.free.reset',amount:dawn,auditRequired:true},
      {source:'legacy.wallet.freeResetRuby',target:'wallet.ruby.free.reset',amount:freeResetExisting,auditRequired:true}
    ],
    migration:{
      version:map.migrationId,
      rawBackup:raw,
      rawBackupSha256:sha256Text(raw),
      idempotent:true,
      migratedAt:'2026-08-27T00:00:00Z',
      auditId:'audit.migration.fixture-or-runtime-assigned'
    }
  };
  return output;
}

export { map as migrationMap };
