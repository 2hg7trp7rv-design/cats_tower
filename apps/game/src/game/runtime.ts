import {
  createBattleEngine,
  type BattleEvent,
  type BattleSnapshot,
} from '@cats-tower/domain';

type Listener = () => void;

class BattleRuntime {
  private readonly listeners = new Set<Listener>();
  private engine = createBattleEngine();
  private pendingVisualEvents: BattleEvent[] = this.engine.drainEvents();

  public getSnapshot = (): BattleSnapshot => this.engine.snapshot();

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public advanceFrame(deltaMs: number): void {
    const beforeTick = this.engine.snapshot().tick;
    this.engine.advance(Math.min(deltaMs, 250));
    this.captureEvents();

    if (this.engine.snapshot().tick !== beforeTick) {
      this.notify();
    }
  }

  public advanceForTest(milliseconds: number): BattleSnapshot {
    const wasPaused = this.engine.snapshot().status === 'paused';
    this.engine.setPaused(false);
    this.captureEvents();

    let remaining = milliseconds;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 5_000);
      this.engine.advance(chunk);
      remaining -= chunk;
    }

    if (wasPaused) {
      this.engine.setPaused(true);
    }

    this.captureEvents();
    this.notify();
    return this.getSnapshot();
  }

  public restart(seed = 20_260_902): BattleSnapshot {
    this.engine.restart(seed);
    this.pendingVisualEvents = this.engine.drainEvents();
    this.notify();
    return this.getSnapshot();
  }

  public pause(): BattleSnapshot {
    this.engine.setPaused(true);
    this.captureEvents();
    this.notify();
    return this.getSnapshot();
  }

  public resume(): BattleSnapshot {
    this.engine.setPaused(false);
    this.captureEvents();
    this.notify();
    return this.getSnapshot();
  }

  public drainVisualEvents(): BattleEvent[] {
    const events = this.pendingVisualEvents;
    this.pendingVisualEvents = [];
    return events;
  }

  private captureEvents(): void {
    this.pendingVisualEvents.push(...this.engine.drainEvents());
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const battleRuntime = new BattleRuntime();
