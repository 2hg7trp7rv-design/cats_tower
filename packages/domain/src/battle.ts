import {
  CANONICAL_BINDING,
  addUnsigned,
  assertUnsigned,
  ceilPercent,
  createCanonicalRng,
  expandedStatValue,
  generateCanonicalFloor,
  getCanonicalLaunchParty,
  levelCost,
  randomSignedUnit,
  subtractUnsigned,
  toBigInt,
} from './canonical';
import type {
  BattleEngineOptions,
  BattleEvent,
  BattleSnapshot,
  BattleStatus,
  CatRole,
  CatSnapshot,
  EnemySnapshot,
  UnsignedDecimalString,
} from './types';

const FIXED_STEP_MS = CANONICAL_BINDING.fixedStepMs;
const ENEMY_RESPAWN_MS = 650;
const PARTY_RECOVERY_MS = 1_200;

type EventDetail = Partial<
  Pick<BattleEvent, 'actorId' | 'targetId' | 'amount'>
>;

interface MutableCat {
  id: string;
  name: string;
  role: CatRole;
  hp: bigint;
  maxHp: bigint;
  baseHp: bigint;
  baseAttackDamage: bigint;
  hpPerLevel: bigint;
  attackPerLevel: bigint;
  attackIntervalMs: number;
  cooldownMs: number;
  alive: boolean;
}

interface MutableEnemy {
  id: string;
  name: string;
  floor: UnsignedDecimalString;
  hp: bigint;
  maxHp: bigint;
  attackDamage: bigint;
  rewardCoin: bigint;
  attackIntervalMs: number;
  cooldownMs: number;
  alive: boolean;
}

interface MutableOptions {
  startFloor: UnsignedDecimalString;
  startCoins: UnsignedDecimalString;
  partyLevel: UnsignedDecimalString;
}

// V2-0 does not yet have a simulation-sealed per-character realtime combat
// operation. These values are deliberately isolated and reported as
// provisional; floor/enemy/economy/tick/RNG truth comes from candidate-v3 and
// engine-v2 through canonical.ts.
const bootstrapStats: Record<
  string,
  {
    readonly baseHp: bigint;
    readonly baseAttack: bigint;
    readonly hpPerLevel: bigint;
    readonly attackPerLevel: bigint;
    readonly attackIntervalMs: number;
    readonly initialCooldownMs: number;
  }
> = {
  'character.launch.001': {
    baseHp: 180n,
    baseAttack: 10n,
    hpPerLevel: 8n,
    attackPerLevel: 1n,
    attackIntervalMs: 900,
    initialCooldownMs: 250,
  },
  'character.launch.002': {
    baseHp: 96n,
    baseAttack: 13n,
    hpPerLevel: 4n,
    attackPerLevel: 2n,
    attackIntervalMs: 800,
    initialCooldownMs: 500,
  },
  'character.launch.003': {
    baseHp: 112n,
    baseAttack: 4n,
    hpPerLevel: 5n,
    attackPerLevel: 1n,
    attackIntervalMs: 1_050,
    initialCooldownMs: 650,
  },
  'character.launch.004': {
    baseHp: 92n,
    baseAttack: 15n,
    hpPerLevel: 4n,
    attackPerLevel: 2n,
    attackIntervalMs: 650,
    initialCooldownMs: 400,
  },
};

const normalizeSeed = (seed: string | number): string => {
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new RangeError('numeric seed must be a non-negative safe integer');
    }
    return String(seed);
  }

  if (seed.length === 0) {
    throw new RangeError('seed must not be empty');
  }

  return seed;
};

const normalizeOptions = (options: BattleEngineOptions = {}): MutableOptions => ({
  startFloor: assertUnsigned(options.startFloor ?? '1', 'startFloor', {
    positive: true,
  }),
  startCoins: assertUnsigned(options.startCoins ?? '0', 'startCoins'),
  partyLevel: assertUnsigned(options.partyLevel ?? '1', 'partyLevel', {
    positive: true,
  }),
});

const statAtLevel = (
  base: bigint,
  perLevel: bigint,
  level: bigint,
): bigint => base + (level - 1n) * perLevel;

const createParty = (partyLevel: UnsignedDecimalString): MutableCat[] => {
  const level = toBigInt(partyLevel, 'partyLevel');

  return getCanonicalLaunchParty().map((canonicalCat) => {
    const stats = bootstrapStats[canonicalCat.id];
    if (!stats) {
      throw new Error(`BOOTSTRAP_STATS_MISSING:${canonicalCat.id}`);
    }

    const maxHp = statAtLevel(stats.baseHp, stats.hpPerLevel, level);

    return {
      id: canonicalCat.id,
      name: canonicalCat.name,
      role: canonicalCat.role,
      hp: maxHp,
      maxHp,
      baseHp: stats.baseHp,
      baseAttackDamage: stats.baseAttack,
      hpPerLevel: stats.hpPerLevel,
      attackPerLevel: stats.attackPerLevel,
      attackIntervalMs: stats.attackIntervalMs,
      cooldownMs: stats.initialCooldownMs,
      alive: true,
    };
  });
};

const normalEnemyId = (floor: UnsignedDecimalString): string => {
  const ordinal = ((toBigInt(floor) - 1n) % 6n) + 1n;
  return `enemy.normal.${ordinal.toString().padStart(3, '0')}`;
};

const enemyIdentity = (
  floor: UnsignedDecimalString,
  boss: { readonly kind: 'none' | 'mid' | 'district'; readonly id: string },
): { readonly id: string; readonly name: string } => {
  if (boss.kind === 'district') {
    return { id: boss.id, name: floor === '10' ? '影月翼' : '地区ボス' };
  }
  if (boss.kind === 'mid') {
    return { id: boss.id, name: '昇降機の番獣' };
  }

  const id = normalEnemyId(floor);
  const names: Record<string, string> = {
    'enemy.normal.001': '煤ネズミ',
    'enemy.normal.002': '鉄くずモグラ',
    'enemy.normal.003': '滑車コウモリ',
    'enemy.normal.004': 'すす羽カラス',
    'enemy.normal.005': '鎖巻きトカゲ',
    'enemy.normal.006': '歯車ヤマネ',
  };
  return { id, name: names[id] ?? '塔の魔物' };
};

const enemyInterval = (bossKind: 'none' | 'mid' | 'district'): number => {
  if (bossKind === 'district') return 1_250;
  if (bossKind === 'mid') return 1_180;
  return 1_100;
};

const createEnemy = (floor: UnsignedDecimalString): MutableEnemy => {
  const descriptor = generateCanonicalFloor(floor);
  const identity = enemyIdentity(floor, descriptor.boss);
  const maxHp = toBigInt(expandedStatValue(descriptor.hp, 'enemy.hp'));

  return {
    id: identity.id,
    name: identity.name,
    floor,
    hp: maxHp,
    maxHp,
    attackDamage: toBigInt(
      expandedStatValue(descriptor.attack, 'enemy.attack'),
    ),
    rewardCoin: toBigInt(
      expandedStatValue(descriptor.coin, 'enemy.coin'),
    ),
    attackIntervalMs: enemyInterval(descriptor.boss.kind),
    cooldownMs: 900,
    alive: true,
  };
};

const cloneCat = (cat: MutableCat, partyLevel: bigint): CatSnapshot => ({
  id: cat.id,
  name: cat.name,
  role: cat.role,
  hp: cat.hp.toString(),
  maxHp: cat.maxHp.toString(),
  attackDamage: statAtLevel(
    cat.baseAttackDamage,
    cat.attackPerLevel,
    partyLevel,
  ).toString(),
  attackIntervalMs: cat.attackIntervalMs,
  cooldownMs: cat.cooldownMs,
  alive: cat.alive,
});

const cloneEnemy = (enemy: MutableEnemy): EnemySnapshot => ({
  id: enemy.id,
  name: enemy.name,
  floor: enemy.floor,
  hp: enemy.hp.toString(),
  maxHp: enemy.maxHp.toString(),
  attackDamage: enemy.attackDamage.toString(),
  rewardCoin: enemy.rewardCoin.toString(),
  attackIntervalMs: enemy.attackIntervalMs,
  cooldownMs: enemy.cooldownMs,
  alive: enemy.alive,
});

export class BattleEngine {
  private seed: string;
  private random: ReturnType<typeof createCanonicalRng>;
  private options: MutableOptions;
  private status: BattleStatus = 'running';
  private tick = 0;
  private elapsedMs = 0;
  private accumulatorMs = 0;
  private partyLevel: bigint;
  private coins: bigint;
  private kills = 0n;
  private floor: UnsignedDecimalString;
  private pendingFloor: UnsignedDecimalString | null = null;
  private respawnRemainingMs = 0;
  private partyRecoveryRemainingMs = 0;
  private eventSerial = 0;
  private cats: MutableCat[];
  private enemy: MutableEnemy;
  private events: BattleEvent[] = [];
  private lastEvent: BattleEvent;

  public constructor(
    seed: string | number = '20260902',
    options: BattleEngineOptions = {},
  ) {
    this.seed = normalizeSeed(seed);
    this.options = normalizeOptions(options);
    this.random = createCanonicalRng(`${this.seed}|battle`);
    this.partyLevel = toBigInt(this.options.partyLevel);
    this.coins = toBigInt(this.options.startCoins);
    this.floor = this.options.startFloor;
    this.cats = createParty(this.partyLevel.toString());
    this.enemy = createEnemy(this.floor);
    this.lastEvent = this.makeEvent('battle-started', `${this.floor}F 戦闘開始`);
    this.events.push(this.lastEvent);
  }

  public restart(
    seed: string | number = this.seed,
    options: BattleEngineOptions = this.options,
  ): void {
    this.seed = normalizeSeed(seed);
    this.options = normalizeOptions(options);
    this.random = createCanonicalRng(`${this.seed}|battle`);
    this.status = 'running';
    this.tick = 0;
    this.elapsedMs = 0;
    this.accumulatorMs = 0;
    this.partyLevel = toBigInt(this.options.partyLevel);
    this.coins = toBigInt(this.options.startCoins);
    this.kills = 0n;
    this.floor = this.options.startFloor;
    this.pendingFloor = null;
    this.respawnRemainingMs = 0;
    this.partyRecoveryRemainingMs = 0;
    this.eventSerial = 0;
    this.cats = createParty(this.partyLevel.toString());
    this.enemy = createEnemy(this.floor);
    this.events = [];
    this.lastEvent = this.makeEvent('battle-started', `${this.floor}F 戦闘開始`);
    this.events.push(this.lastEvent);
  }

  public setPaused(paused: boolean): void {
    const nextStatus: BattleStatus = paused ? 'paused' : 'running';

    if (this.status === nextStatus) {
      return;
    }

    this.status = nextStatus;
    this.emit(paused ? 'paused' : 'resumed', paused ? '一時停止' : '戦闘再開');
  }

  public advance(deltaMs: number): void {
    if (this.status === 'paused') {
      return;
    }

    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError('deltaMs must be a finite non-negative number.');
    }

    this.accumulatorMs += deltaMs;

    while (this.accumulatorMs >= FIXED_STEP_MS) {
      this.accumulatorMs -= FIXED_STEP_MS;
      this.fixedStep();
    }
  }

  public levelUp(): boolean {
    const currentLevel = this.partyLevel.toString();
    const cost = levelCost(currentLevel);
    const costValue = toBigInt(cost);

    if (this.coins < costValue) {
      this.emit('level-up-rejected', `coin不足 / 必要 ${cost}`, {
        amount: cost,
      });
      return false;
    }

    this.coins = toBigInt(subtractUnsigned(this.coins.toString(), cost));
    this.partyLevel += 1n;

    for (const cat of this.cats) {
      const previousMaximum = cat.maxHp;
      cat.maxHp = statAtLevel(cat.baseHp, cat.hpPerLevel, this.partyLevel);
      cat.hp += cat.maxHp - previousMaximum;
    }

    this.emit('level-up', `パーティLv.${this.partyLevel}`, {
      amount: this.partyLevel.toString(),
    });
    return true;
  }

  public snapshot(): BattleSnapshot {
    const partyLevel = this.partyLevel.toString();
    const cost = levelCost(partyLevel);

    return {
      schemaVersion: 2,
      seed: this.seed,
      status: this.status,
      tick: this.tick,
      fixedStepMs: FIXED_STEP_MS,
      elapsedMs: this.elapsedMs,
      floor: this.floor,
      partyLevel,
      nextLevelCost: cost,
      canLevelUp: this.coins >= toBigInt(cost),
      coins: this.coins.toString(),
      kills: this.kills.toString(),
      respawnRemainingMs: this.respawnRemainingMs,
      tower: generateCanonicalFloor(this.floor),
      cats: this.cats.map((cat) => cloneCat(cat, this.partyLevel)),
      enemy: cloneEnemy(this.enemy),
      lastEvent: { ...this.lastEvent },
      authority: { ...CANONICAL_BINDING },
    };
  }

  public drainEvents(): BattleEvent[] {
    const drained = this.events.map((event) => ({ ...event }));
    this.events.length = 0;
    return drained;
  }

  private fixedStep(): void {
    this.tick += 1;
    this.elapsedMs += FIXED_STEP_MS;

    if (this.partyRecoveryRemainingMs > 0) {
      this.partyRecoveryRemainingMs = Math.max(
        0,
        this.partyRecoveryRemainingMs - FIXED_STEP_MS,
      );

      if (this.partyRecoveryRemainingMs === 0) {
        for (const cat of this.cats) {
          cat.hp = cat.maxHp;
          cat.alive = true;
          cat.cooldownMs = cat.attackIntervalMs;
        }
        this.emit('party-recovered', 'パーティ復帰');
      }
      return;
    }

    if (this.respawnRemainingMs > 0) {
      this.respawnRemainingMs = Math.max(
        0,
        this.respawnRemainingMs - FIXED_STEP_MS,
      );

      if (this.respawnRemainingMs === 0) {
        this.spawnPendingFloor();
      }
      return;
    }

    this.advanceParty();
    this.advanceEnemy();

    if (!this.cats.some((cat) => cat.alive)) {
      this.partyRecoveryRemainingMs = PARTY_RECOVERY_MS;
    }
  }

  private spawnPendingFloor(): void {
    if (!this.pendingFloor) {
      throw new Error('RESPAWN_WITHOUT_PENDING_FLOOR');
    }

    this.floor = this.pendingFloor;
    this.pendingFloor = null;
    this.enemy = createEnemy(this.floor);
    this.emit('floor-advanced', `${this.floor}Fへ進行`, {
      amount: this.floor,
    });
    this.emit('enemy-spawned', `${this.floor}F ${this.enemy.name}`);
  }

  private advanceParty(): void {
    for (const cat of this.cats) {
      if (!cat.alive || !this.enemy.alive) {
        continue;
      }

      cat.cooldownMs = Math.max(0, cat.cooldownMs - FIXED_STEP_MS);
      if (cat.cooldownMs > 0) {
        continue;
      }
      cat.cooldownMs = cat.attackIntervalMs;

      if (cat.role === 'healing-support') {
        const wounded = this.cats
          .filter((candidate) => candidate.alive && candidate.hp < candidate.maxHp)
          .sort((left, right) => {
            const leftRatio = left.hp * right.maxHp;
            const rightRatio = right.hp * left.maxHp;
            return leftRatio < rightRatio ? -1 : leftRatio > rightRatio ? 1 : 0;
          })[0];

        if (wounded) {
          const missing = wounded.maxHp - wounded.hp;
          const requested = 8n + this.partyLevel;
          const amount = missing < requested ? missing : requested;
          wounded.hp += amount;
          this.emit('heal', `${cat.name}が${wounded.name}を回復`, {
            actorId: cat.id,
            targetId: wounded.id,
            amount: amount.toString(),
          });
          continue;
        }
      }

      const baseDamage = statAtLevel(
        cat.baseAttackDamage,
        cat.attackPerLevel,
        this.partyLevel,
      );
      const variedDamage = baseDamage + randomSignedUnit(this.random);
      const damage = variedDamage < 1n ? 1n : variedDamage;

      this.emit('attack', `${cat.name}の攻撃`, {
        actorId: cat.id,
        targetId: this.enemy.id,
        amount: damage.toString(),
      });

      this.enemy.hp = this.enemy.hp > damage ? this.enemy.hp - damage : 0n;

      this.emit('hit', `${damage}ダメージ`, {
        actorId: cat.id,
        targetId: this.enemy.id,
        amount: damage.toString(),
      });

      if (this.enemy.hp === 0n) {
        this.resolveEnemyDefeat(cat.id);
        break;
      }
    }
  }

  private advanceEnemy(): void {
    if (!this.enemy.alive) {
      return;
    }

    this.enemy.cooldownMs = Math.max(
      0,
      this.enemy.cooldownMs - FIXED_STEP_MS,
    );
    if (this.enemy.cooldownMs > 0) {
      return;
    }
    this.enemy.cooldownMs = this.enemy.attackIntervalMs;

    const target =
      this.cats.find(
        (cat) => cat.alive && cat.role === 'frontline-control',
      ) ?? this.cats.find((cat) => cat.alive);

    if (!target) {
      return;
    }

    const variedDamage = this.enemy.attackDamage + randomSignedUnit(this.random);
    const damage = variedDamage < 1n ? 1n : variedDamage;

    this.emit('attack', `${this.enemy.name}の攻撃`, {
      actorId: this.enemy.id,
      targetId: target.id,
      amount: damage.toString(),
    });

    target.hp = target.hp > damage ? target.hp - damage : 0n;

    this.emit('hit', `${target.name}に${damage}ダメージ`, {
      actorId: this.enemy.id,
      targetId: target.id,
      amount: damage.toString(),
    });

    if (target.hp === 0n) {
      target.alive = false;
    }
  }

  private resolveEnemyDefeat(actorId: string): void {
    this.enemy.alive = false;
    this.kills += 1n;
    const reward = this.enemy.rewardCoin.toString();
    this.coins = toBigInt(addUnsigned(this.coins.toString(), reward));

    this.emit('defeat', `${this.floor}Fの敵を撃破`, {
      actorId,
      targetId: this.enemy.id,
    });
    this.emit('reward', `+${reward} coin`, {
      actorId,
      amount: reward,
    });

    for (const cat of this.cats) {
      if (cat.alive) {
        const recovery = toBigInt(ceilPercent(cat.maxHp.toString(), 8n));
        const recovered = cat.hp + recovery;
        cat.hp = recovered > cat.maxHp ? cat.maxHp : recovered;
      }
    }

    this.pendingFloor = (toBigInt(this.floor) + 1n).toString();
    this.respawnRemainingMs = ENEMY_RESPAWN_MS;
  }

  private emit(type: BattleEvent['type'], label: string, detail: EventDetail = {}): void {
    const event = this.makeEvent(type, label, detail);
    this.lastEvent = event;
    this.events.push(event);
  }

  private makeEvent(
    type: BattleEvent['type'],
    label: string,
    detail: EventDetail = {},
  ): BattleEvent {
    this.eventSerial += 1;

    return {
      id: `${this.tick}-${this.eventSerial}`,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      type,
      label,
      ...detail,
    };
  }
}

export const createBattleEngine = (
  seed?: string | number,
  options?: BattleEngineOptions,
): BattleEngine => new BattleEngine(seed, options);
