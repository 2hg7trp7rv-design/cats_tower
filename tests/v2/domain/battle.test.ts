import { describe, expect, it } from 'vitest';
import candidateDocument from '../../../simulation/candidate-v3.json';
// @ts-expect-error The sealed engine currently has no TypeScript declarations.
import { generateFloor as engineGenerateFloor } from '../../../simulation/engine-v2/tower.mjs';
import {
  CANONICAL_BINDING,
  createBattleEngine,
  generateCanonicalFloor,
  getCanonicalLaunchParty,
} from '@cats-tower/domain';

const comparableSnapshot = (seed: string | number, milliseconds: number) => {
  const engine = createBattleEngine(seed);
  engine.advance(milliseconds);
  const snapshot = engine.snapshot();

  return {
    seed: snapshot.seed,
    tick: snapshot.tick,
    fixedStepMs: snapshot.fixedStepMs,
    elapsedMs: snapshot.elapsedMs,
    floor: snapshot.floor,
    partyLevel: snapshot.partyLevel,
    coins: snapshot.coins,
    kills: snapshot.kills,
    tower: snapshot.tower,
    cats: snapshot.cats,
    enemy: snapshot.enemy,
    lastEvent: snapshot.lastEvent,
    authority: snapshot.authority,
  };
};

const expectUnsignedString = (value: string): void => {
  expect(value).toMatch(/^(0|[1-9][0-9]*)$/);
};

describe('canonical source binding', () => {
  it('uses candidate-v3 and the sealed engine-v2 floor generator without copying the curve', () => {
    for (const floor of ['1', '10', '100', '1000']) {
      expect(generateCanonicalFloor(floor)).toEqual(
        engineGenerateFloor(candidateDocument, floor),
      );
    }

    expect(CANONICAL_BINDING.fixedStepMs).toBe(50);
    expect(CANONICAL_BINDING.candidatePath).toBe(
      'simulation/candidate-v3.json',
    );
    expect(CANONICAL_BINDING.numericEnginePath).toBe(
      'simulation/engine-v2/numeric.mjs',
    );
    expect(CANONICAL_BINDING.randomEnginePath).toBe(
      'simulation/engine-v2/rng.mjs',
    );
    expect(CANONICAL_BINDING.towerEnginePath).toBe(
      'simulation/engine-v2/tower.mjs',
    );
  });

  it('loads the four exact canonical character IDs, names and roles', () => {
    expect(getCanonicalLaunchParty()).toEqual([
      {
        id: 'character.launch.001',
        name: 'ムギ',
        role: 'frontline-control',
      },
      {
        id: 'character.launch.002',
        name: 'ルナ',
        role: 'ranged-anti-air',
      },
      {
        id: 'character.launch.003',
        name: 'トト',
        role: 'healing-support',
      },
      {
        id: 'character.launch.004',
        name: 'コハク',
        role: 'runner-backline-disruption',
      },
    ]);
  });
});

describe('BattleEngine', () => {
  it('is deterministic for the same seed and elapsed time', () => {
    expect(comparableSnapshot('42', 30_000)).toEqual(
      comparableSnapshot('42', 30_000),
    );
  });

  it('serializes unbounded gameplay quantities as normalized decimal strings', () => {
    const snapshot = comparableSnapshot('20260902', 15_000);

    expectUnsignedString(snapshot.floor);
    expectUnsignedString(snapshot.partyLevel);
    expectUnsignedString(snapshot.coins);
    expectUnsignedString(snapshot.kills);
    expectUnsignedString(snapshot.enemy.hp);
    expectUnsignedString(snapshot.enemy.maxHp);
    expectUnsignedString(snapshot.enemy.attackDamage);
    expectUnsignedString(snapshot.enemy.rewardCoin);

    for (const cat of snapshot.cats) {
      expectUnsignedString(cat.hp);
      expectUnsignedString(cat.maxHp);
      expectUnsignedString(cat.attackDamage);
    }
  });

  it('connects a canonical floor defeat to its candidate-v3 coin reward and the next floor', () => {
    const engine = createBattleEngine('20260902');
    engine.advance(30_000);
    const snapshot = engine.snapshot();
    const events = engine.drainEvents();

    expect(BigInt(snapshot.kills)).toBeGreaterThan(0n);
    expect(BigInt(snapshot.coins)).toBeGreaterThan(0n);
    expect(BigInt(snapshot.floor)).toBeGreaterThan(1n);
    expect(events.some((event) => event.type === 'reward')).toBe(true);
    expect(events.some((event) => event.type === 'floor-advanced')).toBe(true);
    expect(snapshot.partyLevel).toBe('1');
  });

  it('spends the candidate-v3 first level cost only when the player requests growth', () => {
    const engine = createBattleEngine('level-test', { startCoins: '25' });

    expect(engine.snapshot().nextLevelCost).toBe('25');
    expect(engine.levelUp()).toBe(true);
    expect(engine.snapshot().partyLevel).toBe('2');
    expect(engine.snapshot().coins).toBe('0');
    expect(engine.levelUp()).toBe(false);
  });

  it('continues from the first district boss floor 10 to floor 11', () => {
    const engine = createBattleEngine('district-transition', {
      startFloor: '10',
    });

    engine.advance(30_000);
    const snapshot = engine.snapshot();
    const events = engine.drainEvents();

    expect(BigInt(snapshot.floor)).toBeGreaterThanOrEqual(11n);
    expect(
      events.some(
        (event) => event.type === 'floor-advanced' && event.amount === '11',
      ),
    ).toBe(true);
  });

  it('fails closed instead of coercing symbolic floor stats to unsafe Number values', () => {
    expect(() =>
      createBattleEngine('symbolic-boundary', { startFloor: '1001' }),
    ).toThrow(/symbolic/i);
  });

  it('does not advance while paused', () => {
    const engine = createBattleEngine('7');
    engine.advance(5_000);
    engine.setPaused(true);
    const before = engine.snapshot();

    engine.advance(20_000);
    const after = engine.snapshot();

    expect(after.tick).toBe(before.tick);
    expect(after.coins).toBe(before.coins);
    expect(after.status).toBe('paused');
  });
});
