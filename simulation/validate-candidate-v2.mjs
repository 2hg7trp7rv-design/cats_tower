#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';
import { gitBlobSha } from './engine-v2/hash.mjs';
import { assertUnsigned, parseExactDecimal, compare, rational, toBigInt } from './engine-v2/numeric.mjs';
import { assertProbabilityTable } from './engine-v2/economy.mjs';
import { districtId, cycleId, milestoneId, isCanonicalDistrictId, isCanonicalCycleId, isCanonicalMilestoneId, bossForFloor } from './engine-v2/tower.mjs';

const candidatePath=resolve(process.argv[2] ?? 'simulation/candidate-v2.json');
const schemaPath=resolve('simulation/candidate-v2.schema.json');
const developmentManifestOnly=process.argv.includes('--development-source-manifest-only') || process.env.CT_DEV_SOURCE_MANIFEST_ONLY==='1';
const candidate=JSON.parse(await readFile(candidatePath,'utf8'));
const schema=JSON.parse(await readFile(schemaPath,'utf8'));
const errors=[];
const sourceReadback=[];
const check=(condition,code,message)=>{if(!condition)errors.push({code,message});};
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

try { assertSchema(candidate,schema); } catch (error) {
  for (const detail of error.errors ?? [{path:'#',keyword:'schema',message:error.message}]) errors.push({code:'SCHEMA',message:`${detail.path} ${detail.keyword}: ${detail.message}`});
}

const requiredTop=['meta','numeric','tower','combat','offline','shops','delivery','characters','weapons','rarities','levels','evolution','characterMastery','weaponMastery','gacha','wallet','reset','login','products','payments','ads','entitlements','accounts','screens','builds','personas','runMatrix','monteCarlo','stateTransitions','fixtures','migrations','invariants','output'];
check(eq(Object.keys(candidate),requiredTop),'TOP_LEVEL_FIELDS','candidate top-level fields or ordering differ from the sealed dependency closure implementation');
const missingTop=requiredTop.filter((key)=>!Object.prototype.hasOwnProperty.call(candidate,key));
if (missingTop.length) {
  console.error(JSON.stringify({ok:false,candidate:candidatePath,errorCount:errors.length,errors,sourceReadback},null,2));
  process.exit(1);
}
check(candidate.meta.candidateId==='cats-tower-v2-candidate-001','CANDIDATE_ID','unexpected candidate ID');
check(candidate.meta.schemaVersion==='2.0.0','SCHEMA_VERSION','schemaVersion must be 2.0.0');
check(candidate.meta.algorithmVersion==='cats-tower-simulator-v2.0.0','ALGORITHM_VERSION','algorithmVersion must be V2');
check(candidate.meta.sourceStep1Seal.gitBlob==='0a959de0383b57ad6cd1f33c124b398aa51c1e00','STEP1_SEAL','Step 1 seal blob mismatch');
check(candidate.meta.acceptance.gitBlob==='f8986a3d436e93a003ff0f7e07f6a5d28d6faf2f','ACCEPTANCE_BLOB','Step 2 Acceptance blob mismatch');
check(candidate.meta.acceptance.commit==='e02a9af48aaab1a82b1ac4563a4c03f4922eb388','ACCEPTANCE_COMMIT','Step 2 Acceptance commit mismatch');
check(candidate.meta.seedContract.v1ObservedSeedReuse===false,'V1_HOLDOUT_REUSE','V1 observed seeds may not be reused');
check(candidate.meta.roundingVersion==='ct-rational-half-even-v1','ROUNDING_VERSION','rounding version is not fixed');

for (const binding of candidate.meta.sourceBindings) {
  try {
    const bytes=await readFile(resolve(binding.path));
    const actual=gitBlobSha(bytes);
    sourceReadback.push({path:binding.path,expected:binding.gitBlob,actual,status:actual===binding.gitBlob?'PASS':'FAIL'});
    check(actual===binding.gitBlob,'SOURCE_BLOB_MISMATCH',`${binding.path} expected ${binding.gitBlob} got ${actual}`);
  } catch (error) {
    sourceReadback.push({path:binding.path,expected:binding.gitBlob,actual:'UNREADABLE',status:developmentManifestOnly?'DEVELOPMENT_SKIPPED':'FAIL'});
    if (!developmentManifestOnly) errors.push({code:'SOURCE_UNREADABLE',message:`${binding.path}: ${error.message}`});
  }
}

function scan(value,path='#') {
  if (typeof value==='number') check(Number.isFinite(value)&&Number.isSafeInteger(value),'UNSAFE_JSON_NUMBER',`${path} must be a finite safe integer or a decimal string`);
  if (typeof value==='string') {
    check(!['NaN','Infinity','-Infinity'].includes(value),'FORBIDDEN_NUMERIC_LITERAL',`${path} contains forbidden numeric literal`);
    if (/^-?[0-9]+(?:\.[0-9]+)?[eE][+-]?[0-9]+$/.test(value)) errors.push({code:'IMPLICIT_EXPONENT',message:`${path} persists exponent notation`});
    if (/^[0-9,]+$/.test(value)&&value.includes(',')) errors.push({code:'LOCALE_NUMERIC',message:`${path} contains locale separators`});
  }
  if (Array.isArray(value)) value.forEach((x,i)=>scan(x,`${path}/${i}`));
  else if (value&&typeof value==='object') Object.entries(value).forEach(([k,v])=>scan(v,`${path}/${k}`));
}
scan(candidate);

check(candidate.numeric.limits.playerVisibleFloorMaximum==='NONE'&&candidate.tower.playerVisibleMaximum==='NONE','VISIBLE_FLOOR_CAP','tower must have no player-visible maximum');
check(candidate.tower.floor100Role==='FIRST_MAJOR_MILESTONE_NOT_END'&&candidate.tower.floor101Normal===true,'FLOOR_100_BOUNDARY','100F/101F contract is incorrect');
check(candidate.tower.milestones.includes('100')&&candidate.tower.milestones.includes('10000'),'MILESTONES','required milestone horizons missing');
for (const value of ['1','999','1000']) check(isCanonicalDistrictId(districtId(value)),'DISTRICT_ID',`district ID generation failed for ${value}`);
for (const value of ['1','999999','1000000']) check(isCanonicalCycleId(cycleId(value)),'CYCLE_ID',`cycle ID generation failed for ${value}`);
for (const value of ['10','100','10000']) check(isCanonicalMilestoneId(milestoneId(value)),'MILESTONE_ID',`milestone ID generation failed for ${value}`);
check(!isCanonicalDistrictId('tower.district.0001'),'DISTRICT_ALIAS_WRITE','extra-leading-zero district ID was accepted');
check(!isCanonicalCycleId('tower.cycle.0000001'),'CYCLE_ALIAS_WRITE','extra-leading-zero cycle ID was accepted');
check(!isCanonicalMilestoneId('tower.milestone.floor.0100'),'MILESTONE_ALIAS_WRITE','leading-zero milestone ID was accepted');
check(bossForFloor('5').id==='tower.boss.d01.mid.001','MID_BOSS_ID','5F boss stable ID mismatch');
check(bossForFloor('10').id==='tower.boss.d01.kagetsubasa','DISTRICT_BOSS_ID','10F boss stable ID mismatch');

check(candidate.combat.formationSize==='4'&&candidate.combat.temporarySupportLayerSeparate===true,'FORMATION','party/support boundary mismatch');
check(candidate.combat.movement.directTapDamage==='0','DIRECT_TAP_DAMAGE','tap must not directly damage enemies');
check(candidate.offline.calculation.autoBattleBaseline===true&&candidate.offline.serverReconciliation.authoritative===true,'OFFLINE_AUTHORITY','offline progress must be auto and server reconciled');
check(candidate.shops.automation.collectAllRequired===false&&candidate.shops.automation.individualCollectionRequired===false,'SHOP_CHORE','manual collection is incorrectly required');

const rarityOrder=['N','R','RR','SR','SSR','UR'];
check(eq(candidate.rarities.order,rarityOrder),'RARITY_ORDER','rarity order mismatch');
check(candidate.rarities.catalog.every((x,i)=>x.code===rarityOrder[i]&&x.rank===i),'RARITY_RANK','rarity rank mismatch');
check(candidate.characters.catalog.length===24,'CHARACTER_COUNT','character catalog must reserve 24 entries');
check(candidate.weapons.catalog.length===36,'WEAPON_COUNT','weapon catalog must reserve 36 entries');
check(new Set(candidate.characters.catalog.map((x)=>x.id)).size===24,'CHARACTER_IDS','character IDs must be unique');
check(new Set(candidate.weapons.catalog.map((x)=>x.id)).size===36,'WEAPON_IDS','weapon IDs must be unique');
for (let i=1;i<=24;i+=1) check(candidate.characters.catalog.some((x)=>x.id===`character.launch.${String(i).padStart(3,'0')}`),'CHARACTER_RESERVATION',`missing character.launch.${String(i).padStart(3,'0')}`);
for (let i=1;i<=36;i+=1) check(candidate.weapons.catalog.some((x)=>x.id===`weapon.launch.${String(i).padStart(3,'0')}`),'WEAPON_RESERVATION',`missing weapon.launch.${String(i).padStart(3,'0')}`);
const deterministicCharacters=candidate.characters.catalog.filter((x)=>x.acquisition==='DETERMINISTIC_NON_GACHA'&&['N','R'].includes(x.baseRarity));
for (const role of candidate.characters.requiredCoreRoles) check(deterministicCharacters.some((x)=>x.role===role),'NR_CORE_ROLE',`N/R deterministic route missing character role ${role}`);
const deterministicWeapons=candidate.weapons.catalog.filter((x)=>x.acquisition==='DETERMINISTIC_NON_GACHA'&&['N','R'].includes(x.baseRarity));
for (const role of candidate.weapons.requiredCoreRoles) check(deterministicWeapons.some((x)=>x.role===role),'NR_WEAPON_ROLE',`N/R deterministic route missing weapon role ${role}`);
check(candidate.characters.catalog.every((x)=>x.firstCopyFunctional&&!x.coreProgressionGate),'CHARACTER_FIRST_COPY','character first-copy or core-gate rule violated');
check(candidate.weapons.catalog.every((x)=>x.firstCopyFunctional&&!x.coreProgressionGate),'WEAPON_FIRST_COPY','weapon first-copy or core-gate rule violated');

check(candidate.levels.uncappedRule===true,'LEVEL_CAP','coin levels must be uncapped');
check(candidate.evolution.eligibilityEveryLevels==='100'&&candidate.evolution.nonBlockingContinuation===true&&candidate.evolution.orderedCatchUp===true,'EVOLUTION_RULE','evolution eligibility/catch-up/non-blocking rule mismatch');
check(toBigInt(candidate.evolution.firstEvolutionCoverage.firstEffectiveResetMinimumReward)>=toBigInt(candidate.evolution.firstEvolutionCoverage.firstStageCost),'FIRST_EVOLUTION_COVERAGE','first reset reward does not cover first evolution');
check(candidate.evolution.firstEvolutionCoverage.adOrPaymentRequired===false,'FIRST_EVOLUTION_PAYWALL','first evolution requires ad/payment');

for (const [label,track] of [['character',candidate.characterMastery],['weapon',candidate.weaponMastery]]) {
  check(track.firstCopy.functional&&track.firstCopy.roleComplete,'FIRST_COPY_MASTERY',`${label} first copy is not functionally complete`);
  check(toBigInt(track.fullMastery.minimumAdditionalEffectiveCopies)>=20n,'FULL_MASTERY_COPIES',`${label} full mastery is below 20 additional copies`);
  check(track.fullMastery.normalPvePrerequisite===false,'FULL_MASTERY_GATE',`${label} full mastery gates normal PvE`);
  const nodes=track.marginalCurve.nodes;
  let previousCopies=0n, previousCumulative=0n, previousMarginal=null;
  for (const node of nodes) {
    const copies=toBigInt(node.additionalEffectiveCopies); const cumulative=toBigInt(node.cumulativePowerBasisPoints);
    check(copies>previousCopies&&cumulative>previousCumulative,'MASTERY_ORDER',`${label} mastery nodes are not increasing`);
    const marginal=cumulative-previousCumulative;
    if (previousMarginal!==null) check(marginal<previousMarginal,'MASTERY_DIMINISHING',`${label} mastery marginal node gain is not strictly diminishing`);
    previousCopies=copies; previousCumulative=cumulative; previousMarginal=marginal;
  }
  check(track.overflow.neverDiscard===true,'MASTERY_OVERFLOW',`${label} overflow can disappear`);
}

const charIds=new Set(candidate.gacha.characterPools.map((x)=>x.id));
const weaponIds=new Set(candidate.gacha.weaponPools.map((x)=>x.id));
check([...charIds].every((x)=>x.startsWith('banner.character.'))&&[...weaponIds].every((x)=>x.startsWith('banner.weapon.')),'POOL_SEPARATION','character/weapon pools are mixed');
check([...charIds].every((x)=>!weaponIds.has(x)),'POOL_ID_COLLISION','gacha pool IDs collide');
for (const table of candidate.gacha.rates) { try { assertProbabilityTable(table.entries); } catch(error) { errors.push({code:'RATE_TABLE',message:`${table.id}: ${error.message}`}); } }
check(candidate.gacha.hardPity.draws==='100','HARD_PITY','hard pity must be 100');
check(candidate.gacha.featuredGuarantee.draws==='200','FEATURED_GUARANTEE','featured guarantee must be 200');
check(candidate.gacha.carryoverFamilies.compatibleOnly===true,'PITY_CARRYOVER','compatible carryover is not enforced');
check(candidate.gacha.compGachaProhibited===true,'COMP_GACHA','comp gacha must be prohibited');
check(candidate.gacha.newcomerGuarantees.firstDaySSRCharacterByDraw==='50'&&candidate.gacha.newcomerGuarantees.firstDaySRWeaponByDraw==='30','NEWCOMER_GUARANTEE','day-one guarantee route mismatch');
const cadence=candidate.gacha.rewardCadence;
check(toBigInt(cadence.firstTenMinutesCombinedDraws.target)>=50n&&toBigInt(cadence.firstTenMinutesCombinedDraws.target)<=100n,'TEN_MINUTE_DRAWS','first ten minute cadence outside target envelope');
check(toBigInt(cadence.firstHourCombinedDraws.target)>=150n&&toBigInt(cadence.firstHourCombinedDraws.target)<=250n,'FIRST_HOUR_DRAWS','first hour cadence outside target envelope');
check(toBigInt(cadence.noAdF2PDailyCombinedDraws.target)>=40n&&toBigInt(cadence.noAdF2PDailyCombinedDraws.target)<=60n,'DAILY_DRAWS','no-ad daily draw cadence outside target envelope');

const ledgers=[candidate.wallet.paidRuby.id,candidate.wallet.freeResetRuby.id,candidate.wallet.freeAdRuby.id,candidate.wallet.freeOtherRuby.id];
check(eq(ledgers,['wallet.ruby.paid','wallet.ruby.free.reset','wallet.ruby.free.ad','wallet.ruby.free.other']),'WALLET_LEDGERS','ruby provenance ledgers mismatch');
check(candidate.wallet.paidRuby.expires===false,'PAID_EXPIRY','paid ruby must not expire');
check(candidate.wallet.consumptionOrder.paidRubyLast===true,'PAID_CONSUMPTION','paid ruby must be consumed last under the configured policy');
check(candidate.wallet.refundDeficit.silentFreeLedgerDebit===false,'REFUND_FREE_DEBIT','refund deficit may silently consume free ruby');
check(candidate.payments.refundDeficitPolicy.freeLedgersUntouched===true,'REFUND_POLICY','refund policy does not protect free ledgers');

check(candidate.reset.id==='reset.tower_return'&&candidate.reset.count==='1','RESET_COUNT','exactly one reset is required');
check(candidate.reset.floorOneRestart===true&&candidate.reset.reward.repeatSameBest==='0'&&candidate.reset.reward.newRecordRequired===true,'RESET_ANTIFARM','reset floor/repeat-best rule mismatch');
check(candidate.reset.quoteAndCommit.lossKeepGainComplete&&candidate.reset.quoteAndCommit.idempotent&&candidate.reset.quoteAndCommit.serverAuthority,'RESET_QUOTE','reset quote/commit contract incomplete');

check(candidate.ads.rewardedOnly&&candidate.ads.forcedInterstitial===false&&candidate.ads.persistentBanner===false,'AD_MODE','initial ads must be rewarded opt-in only');
check(candidate.ads.receiptVerification.serverSide&&candidate.ads.receiptVerification.exactlyOnce,'AD_RECEIPT','ad receipt is not exactly-once server verified');
check(candidate.login.serverTime&&candidate.login.claimHistory.samePeriodExactlyOnce&&candidate.login.claimHistory.multiTabConverges,'LOGIN_CLAIM','login server-time/exactly-once contract mismatch');
check(candidate.login.campaignCatalogId==='catalog.login_campaign.v1'&&Boolean(candidate.login.campaignVersion),'LOGIN_VERSION','login campaign immutable version missing');
check(candidate.ads.offerCatalogId==='catalog.ad_offer.v1'&&Boolean(candidate.ads.offerVersion),'AD_VERSION','ad offer immutable version missing');

check(candidate.screens.count==='12'&&eq(candidate.screens.registry.map((x)=>x.id),Array.from({length:12},(_,i)=>`S${String(i+1).padStart(2,'0')}`)),'SCREENS','S01-S12 registry mismatch');
check(candidate.builds.length===3&&eq(candidate.builds.map((x)=>x.id),['build.combat','build.reinforcement','build.commerce']),'BUILDS','three build axes mismatch');
check(candidate.personas.length===5&&eq(candidate.personas.map((x)=>x.id),['no-ad-f2p','rewarded-ad-f2p','monthly-pass','controlled-payer','high-spend-stress']),'PERSONAS','five persona axes mismatch');
check(candidate.runMatrix.minimumScenarios==='15000'&&candidate.runMatrix.seedsPerBuildPersona==='1000','RUN_MATRIX','minimum run matrix mismatch');
check(candidate.runMatrix.calibration.namespace!==candidate.runMatrix.holdout.namespace&&candidate.runMatrix.holdout.observedV1Reuse===false&&candidate.runMatrix.holdout.tuningVisible===false,'HOLDOUT','holdout is not disjoint/unseen');
check(candidate.runMatrix.fullMatrixExecution==='STEP3_ONLY'&&candidate.runMatrix.step2Execution==='QUALIFICATION_ONLY','STEP_BOUNDARY','Step 2/3 execution boundary mismatch');

const persona=(id)=>candidate.personas.find((x)=>x.id===id);
const monthlyPersona=persona('monthly-pass');
const stressPersona=persona('high-spend-stress');
const noAdPersona=persona('no-ad-f2p');
if(monthlyPersona) check(compare(parseExactDecimal(monthlyPersona.accelerationMaximum),parseExactDecimal('2.0'))<=0,'MONTHLY_ACCELERATION','monthly pass exceeds 2x target maximum');
if(stressPersona) check(compare(parseExactDecimal(stressPersona.accelerationMaximum),parseExactDecimal('5.0'))<=0,'STRESS_ACCELERATION','high-spend stress exceeds 5x target maximum');
if(noAdPersona){
  const noAdGuarantee=(200n+toBigInt(noAdPersona.dailyFeaturedProgress)-1n)/toBigInt(noAdPersona.dailyFeaturedProgress);
  check(noAdGuarantee>=30n&&noAdGuarantee<=45n,'NO_AD_FEATURED_DAYS',`no-ad featured guarantee day is ${noAdGuarantee}, outside 30-45`);
}

const expectedMachines={draw:'transition.draw.v2',payment:'transition.payment.v2',rewardedAd:'transition.rewarded_ad.v2',loginClaim:'transition.login_claim.v2',towerReturn:'transition.reset.v2',evolution:'transition.evolution.v2',masteryExchange:'transition.mastery_exchange.v2',accountLink:'transition.account_link.v2',accountDeletion:'transition.account_deletion.v1'};
for (const [key,id] of Object.entries(expectedMachines)) check(candidate.stateTransitions.machines[key]?.id===id,'STATE_MACHINE',`missing or wrong state machine ${key}`);
check(candidate.stateTransitions.serverAuthority&&candidate.stateTransitions.clientTimeoutMeansFailure===false,'STATE_AUTHORITY','permanent transition authority/timeout rule mismatch');
check(candidate.migrations.legacyDawnMergedInto==='reset.tower_return'&&candidate.migrations.legacyCurrencyTo==='wallet.ruby.free.reset'&&candidate.migrations.rawBackup&&candidate.migrations.unknownOwnershipFailsClosed,'MIGRATION_CONTRACT','migration contract mismatch');
check(candidate.output.balanceVerdictAllowedInStep2===false,'STEP2_BALANCE_VERDICT','Step 2 may not issue balance PASS');

for (const path of [candidate.fixtures.positive,candidate.fixtures.boundary,candidate.fixtures.negative,candidate.fixtures.stateTransitions,candidate.fixtures.crossRuntime,candidate.fixtures.manifest,candidate.migrations.path,'simulation/run-plan-v2.json','simulation/result-v2.schema.json','simulation/validate-result-v2.mjs','simulation/engine-v2/index.mjs']) {
  try { await access(resolve(path)); } catch { errors.push({code:'DEPENDENCY_MISSING',message:path}); }
}

if (errors.length) {
  console.error(JSON.stringify({ok:false,candidate:candidatePath,errorCount:errors.length,errors,sourceReadback},null,2));
  process.exit(1);
}
console.log(JSON.stringify({ok:true,candidate:candidatePath,schema:schemaPath,sourceReadbackMode:developmentManifestOnly?'DEVELOPMENT_MANIFEST_ONLY':'FULL_GIT_BLOB_READBACK',sourceBindings:sourceReadback,checks:'PASS'}));
