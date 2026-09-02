import { describe, expect, it } from 'vitest';
import { createBattleEngine } from '@cats-tower/domain';

const comparableSnapshot = (seed: number, milliseconds: number) => {
  const engine = createBattleEngine(seed);
  engine.advance(milliseconds);
  const snapshot = engine.snapshot();

  return {
    seed: snapshot.seed,
    tick: snapshot.tick,
    elapsedMs: snapshot.elapsedMs,
    level: snapshot.level,
    coins: snapshot.coins,
    kills: snapshot.kills,
    wave: snapshot.wave,
    cats: snapshot.cats,
    enemy: snapshot.enemy,
    lastEvent: snapshot.lastEvent,
  };
};

describe('BattleEngine', () => {
  it('is deterministic for the same seed and elapsed time', () => {
    expect(comparableSnapshot(42, 30_000)).toEqual(
      comparableSnapshot(42, 30_000),
    );
  });

  it('connects defeat to reward and progression', () => {
    const snapshot = comparableSnapshot(20_260_902, 30_000);

    expect(snapshot.kills).toBeGreaterThan(0);
    expect(snapshot.coins).toBeGreaterThan(0);
    expect(snapshot.wave).toBe(snapshot.kills + 1);
  });

  it('does not advance while paused', () => {
    const engine = createBattleEngine(7);
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
