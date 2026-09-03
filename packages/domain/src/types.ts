import type {
  CanonicalCatRole,
  CanonicalFloorDescriptor,
  UnsignedDecimalString,
} from './canonical';

export type BattleStatus = 'running' | 'paused';
export type CatRole = CanonicalCatRole;

export interface CatSnapshot {
  readonly id: string;
  readonly name: string;
  readonly role: CatRole;
  readonly hp: UnsignedDecimalString;
  readonly maxHp: UnsignedDecimalString;
  readonly attackDamage: UnsignedDecimalString;
  readonly attackIntervalMs: number;
  readonly cooldownMs: number;
  readonly alive: boolean;
}

export interface EnemySnapshot {
  readonly id: string;
  readonly name: string;
  readonly floor: UnsignedDecimalString;
  readonly hp: UnsignedDecimalString;
  readonly maxHp: UnsignedDecimalString;
  readonly attackDamage: UnsignedDecimalString;
  readonly rewardCoin: UnsignedDecimalString;
  readonly attackIntervalMs: number;
  readonly cooldownMs: number;
  readonly alive: boolean;
}

export type BattleEventType =
  | 'battle-started'
  | 'enemy-spawned'
  | 'attack'
  | 'hit'
  | 'heal'
  | 'defeat'
  | 'reward'
  | 'floor-advanced'
  | 'level-up'
  | 'level-up-rejected'
  | 'party-recovered'
  | 'paused'
  | 'resumed';

export interface BattleEvent {
  readonly id: string;
  readonly tick: number;
  readonly elapsedMs: number;
  readonly type: BattleEventType;
  readonly actorId?: string;
  readonly targetId?: string;
  readonly amount?: UnsignedDecimalString;
  readonly label: string;
}

export interface BattleAuthorityBinding {
  readonly candidateId: string;
  readonly candidateSchemaVersion: string;
  readonly algorithmVersion: string;
  readonly candidatePath: string;
  readonly numericEnginePath: string;
  readonly randomEnginePath: string;
  readonly towerEnginePath: string;
  readonly fixedStepMs: number;
  readonly tickVersion: string;
  readonly floorGeneratorVersion: string;
  readonly numericRepresentation: string;
  readonly playerVisibleMaximum: string;
  readonly exactExpansionMaximumFloor: UnsignedDecimalString;
  readonly damageFormulaVersion: string;
  readonly damageFormulaRuntimeStatus: string;
  readonly levelCostVersion: string;
}

export interface BattleSnapshot {
  readonly schemaVersion: 2;
  readonly seed: string;
  readonly status: BattleStatus;
  readonly tick: number;
  readonly fixedStepMs: number;
  readonly elapsedMs: number;
  readonly floor: UnsignedDecimalString;
  readonly partyLevel: UnsignedDecimalString;
  readonly nextLevelCost: UnsignedDecimalString;
  readonly canLevelUp: boolean;
  readonly coins: UnsignedDecimalString;
  readonly kills: UnsignedDecimalString;
  readonly respawnRemainingMs: number;
  readonly tower: CanonicalFloorDescriptor;
  readonly cats: readonly CatSnapshot[];
  readonly enemy: EnemySnapshot;
  readonly lastEvent: BattleEvent;
  readonly authority: BattleAuthorityBinding;
}

export interface BattleEngineOptions {
  readonly startFloor?: UnsignedDecimalString;
  readonly startCoins?: UnsignedDecimalString;
  readonly partyLevel?: UnsignedDecimalString;
}

export type { CanonicalFloorDescriptor, UnsignedDecimalString };
