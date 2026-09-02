export type BattleStatus = 'running' | 'paused';
export type CatRole = 'guardian' | 'striker' | 'ranger' | 'support';

export interface CatSnapshot {
  readonly id: string;
  readonly name: string;
  readonly role: CatRole;
  readonly hp: number;
  readonly maxHp: number;
  readonly attackDamage: number;
  readonly attackIntervalMs: number;
  readonly cooldownMs: number;
  readonly alive: boolean;
}

export interface EnemySnapshot {
  readonly id: string;
  readonly wave: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly attackDamage: number;
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
  | 'level-up'
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
  readonly amount?: number;
  readonly label: string;
}

export interface BattleSnapshot {
  readonly schemaVersion: 1;
  readonly seed: number;
  readonly status: BattleStatus;
  readonly tick: number;
  readonly elapsedMs: number;
  readonly level: number;
  readonly coins: number;
  readonly kills: number;
  readonly wave: number;
  readonly respawnRemainingMs: number;
  readonly cats: readonly CatSnapshot[];
  readonly enemy: EnemySnapshot;
  readonly lastEvent: BattleEvent;
}
