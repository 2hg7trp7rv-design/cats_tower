import { DeterministicRandom } from './random';
import type {
  BattleEvent,
  BattleSnapshot,
  BattleStatus,
  CatRole,
  CatSnapshot,
  EnemySnapshot,
} from './types';

const FIXED_STEP_MS = 100;
const ENEMY_RESPAWN_MS = 700;
const PARTY_RECOVERY_MS = 1_200;

interface MutableCat {
  id: string;
  name: string;
  role: CatRole;
  hp: number;
  maxHp: number;
  attackDamage: number;
  attackIntervalMs: number;
  cooldownMs: number;
  alive: boolean;
}

interface MutableEnemy {
  id: string;
  wave: number;
  hp: number;
  maxHp: number;
  attackDamage: number;
  attackIntervalMs: number;
  cooldownMs: number;
  alive: boolean;
}

const createParty = (): MutableCat[] => [
  {
    id: 'cat.guardian',
    name: 'トト',
    role: 'guardian',
    hp: 150,
    maxHp: 150,
    attackDamage: 6,
    attackIntervalMs: 900,
    cooldownMs: 300,
    alive: true,
  },
  {
    id: 'cat.striker',
    name: 'コハク',
    role: 'striker',
    hp: 100,
    maxHp: 100,
    attackDamage: 10,
    attackIntervalMs: 650,
    cooldownMs: 450,
    alive: true,
  },
  {
    id: 'cat.ranger',
    name: 'ルナ',
    role: 'ranger',
    hp: 86,
    maxHp: 86,
    attackDamage: 8,
    attackIntervalMs: 780,
    cooldownMs: 600,
    alive: true,
  },
  {
    id: 'cat.support',
    name: 'ムギ',
    role: 'support',
    hp: 92,
    maxHp: 92,
    attackDamage: 4,
    attackIntervalMs: 1_050,
    cooldownMs: 750,
    alive: true,
  },
];

const createEnemy = (wave: number, level: number): MutableEnemy => {
  const maxHp = 42 + wave * 11 + Math.max(0, level - 1) * 7;

  return {
    id: `enemy.ash-mouse.${wave}`,
    wave,
    hp: maxHp,
    maxHp,
    attackDamage: 3 + Math.floor(wave / 6),
    attackIntervalMs: Math.max(720, 1_150 - wave * 5),
    cooldownMs: 900,
    alive: true,
  };
};

const cloneCat = (cat: MutableCat): CatSnapshot => ({ ...cat });
const cloneEnemy = (enemy: MutableEnemy): EnemySnapshot => ({ ...enemy });

export class BattleEngine {
  private seed: number;
  private random: DeterministicRandom;
  private status: BattleStatus = 'running';
  private tick = 0;
  private elapsedMs = 0;
  private accumulatorMs = 0;
  private level = 1;
  private coins = 0;
  private kills = 0;
  private wave = 1;
  private respawnRemainingMs = 0;
  private partyRecoveryRemainingMs = 0;
  private eventSerial = 0;
  private cats: MutableCat[] = createParty();
  private enemy: MutableEnemy;
  private events: BattleEvent[] = [];
  private lastEvent: BattleEvent;

  public constructor(seed = 20_260_902) {
    this.seed = seed >>> 0;
    this.random = new DeterministicRandom(this.seed);
    this.enemy = createEnemy(this.wave, this.level);
    this.lastEvent = this.makeEvent('battle-started', '戦闘開始');
    this.events.push(this.lastEvent);
  }

  public restart(seed = this.seed): void {
    this.seed = seed >>> 0;
    this.random = new DeterministicRandom(this.seed);
    this.status = 'running';
    this.tick = 0;
    this.elapsedMs = 0;
    this.accumulatorMs = 0;
    this.level = 1;
    this.coins = 0;
    this.kills = 0;
    this.wave = 1;
    this.respawnRemainingMs = 0;
    this.partyRecoveryRemainingMs = 0;
    this.eventSerial = 0;
    this.cats = createParty();
    this.enemy = createEnemy(this.wave, this.level);
    this.events = [];
    this.lastEvent = this.makeEvent('battle-started', '戦闘開始');
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

  public snapshot(): BattleSnapshot {
    return {
      schemaVersion: 1,
      seed: this.seed,
      status: this.status,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      level: this.level,
      coins: this.coins,
      kills: this.kills,
      wave: this.wave,
      respawnRemainingMs: this.respawnRemainingMs,
      cats: this.cats.map(cloneCat),
      enemy: cloneEnemy(this.enemy),
      lastEvent: { ...this.lastEvent },
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
        this.enemy = createEnemy(this.wave, this.level);
        this.emit('enemy-spawned', `第${this.wave}波`);
      }

      return;
    }

    this.advanceParty();
    this.advanceEnemy();

    if (!this.cats.some((cat) => cat.alive)) {
      this.partyRecoveryRemainingMs = PARTY_RECOVERY_MS;
    }
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

      if (cat.role === 'support') {
        const wounded = this.cats
          .filter((candidate) => candidate.alive && candidate.hp < candidate.maxHp)
          .sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp)[0];

        if (wounded) {
          const amount = Math.min(
            wounded.maxHp - wounded.hp,
            7 + Math.floor(this.level / 2),
          );
          wounded.hp += amount;
          this.emit('heal', `${cat.name}が${wounded.name}を回復`, {
            actorId: cat.id,
            targetId: wounded.id,
            amount,
          });
          continue;
        }
      }

      const damage = Math.max(
        1,
        cat.attackDamage + this.random.integer(-1, 1) + Math.floor((this.level - 1) / 2),
      );

      this.emit('attack', `${cat.name}の攻撃`, {
        actorId: cat.id,
        targetId: this.enemy.id,
        amount: damage,
      });

      this.enemy.hp = Math.max(0, this.enemy.hp - damage);

      this.emit('hit', `${damage}ダメージ`, {
        actorId: cat.id,
        targetId: this.enemy.id,
        amount: damage,
      });

      if (this.enemy.hp === 0) {
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
      this.cats.find((cat) => cat.alive && cat.role === 'guardian') ??
      this.cats.find((cat) => cat.alive);

    if (!target) {
      return;
    }

    const damage = Math.max(
      1,
      this.enemy.attackDamage + this.random.integer(-1, 1),
    );

    this.emit('attack', '灰ネズミの攻撃', {
      actorId: this.enemy.id,
      targetId: target.id,
      amount: damage,
    });

    target.hp = Math.max(0, target.hp - damage);

    this.emit('hit', `${target.name}に${damage}ダメージ`, {
      actorId: this.enemy.id,
      targetId: target.id,
      amount: damage,
    });

    if (target.hp === 0) {
      target.alive = false;
    }
  }

  private resolveEnemyDefeat(actorId: string): void {
    this.enemy.alive = false;
    this.kills += 1;

    const reward = 9 + this.wave * 3;
    this.coins += reward;

    this.emit('defeat', '敵を撃破', {
      actorId,
      targetId: this.enemy.id,
    });
    this.emit('reward', `+${reward} coin`, {
      actorId,
      amount: reward,
    });

    for (const cat of this.cats) {
      if (cat.alive) {
        cat.hp = Math.min(cat.maxHp, cat.hp + Math.ceil(cat.maxHp * 0.08));
      }
    }

    if (this.kills % 3 === 0) {
      this.level += 1;

      for (const cat of this.cats) {
        cat.attackDamage += cat.role === 'striker' ? 2 : 1;
        cat.maxHp += cat.role === 'guardian' ? 8 : 4;
        cat.hp = Math.min(cat.maxHp, cat.hp + 8);
      }

      this.emit('level-up', `パーティLv.${this.level}`, {
        amount: this.level,
      });
    }

    this.wave += 1;
    this.respawnRemainingMs = ENEMY_RESPAWN_MS;
  }

  private emit(
    type: BattleEvent['type'],
    label: string,
    detail: Pick<BattleEvent, 'actorId' | 'targetId' | 'amount'> = {},
  ): void {
    const event = this.makeEvent(type, label, detail);
    this.lastEvent = event;
    this.events.push(event);
  }

  private makeEvent(
    type: BattleEvent['type'],
    label: string,
    detail: Pick<BattleEvent, 'actorId' | 'targetId' | 'amount'> = {},
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

export const createBattleEngine = (seed?: number): BattleEngine =>
  new BattleEngine(seed);
