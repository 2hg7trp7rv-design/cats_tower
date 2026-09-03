import * as Phaser from 'phaser';
import type {
  BattleEvent,
  BattleSnapshot,
  CatRole,
} from '@cats-tower/domain';
import { ratioForDisplay } from '@cats-tower/domain';
import { battleRuntime } from './runtime';

interface VisualEffect {
  readonly type: 'attack' | 'hit' | 'heal' | 'defeat' | 'reward';
  readonly actorId?: string;
  readonly targetId?: string;
  readonly amount?: string;
  readonly createdAt: number;
}

const WIDTH = 390;
const HEIGHT = 360;
const FLOOR_Y = 285;

const roleColor: Record<CatRole, number> = {
  'frontline-control': 0x78a8c8,
  'ranged-anti-air': 0xa890d6,
  'healing-support': 0x83b89b,
  'runner-backline-disruption': 0xe4a267,
};

export class BattleScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private floorTitle!: Phaser.GameObjects.Text;
  private effects: VisualEffect[] = [];

  public constructor() {
    super('battle');
  }

  public create(): void {
    this.cameras.main.setBackgroundColor('#07131c');
    this.graphics = this.add.graphics();
    this.floorTitle = this.add
      .text(16, 12, '1F・第1区画', {
        color: '#f2e9d4',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
      })
      .setDepth(2);
  }

  public update(time: number, delta: number): void {
    battleRuntime.advanceFrame(delta);

    for (const event of battleRuntime.drainVisualEvents()) {
      this.captureEffect(event, time);
    }

    this.effects = this.effects.filter((effect) => time - effect.createdAt < 620);
    this.renderBattle(battleRuntime.getSnapshot(), time);
  }

  private captureEffect(event: BattleEvent, time: number): void {
    if (
      event.type === 'attack' ||
      event.type === 'hit' ||
      event.type === 'heal' ||
      event.type === 'defeat' ||
      event.type === 'reward'
    ) {
      this.effects.push({
        type: event.type,
        actorId: event.actorId,
        targetId: event.targetId,
        amount: event.amount,
        createdAt: time,
      });
    }
  }

  private renderBattle(snapshot: BattleSnapshot, time: number): void {
    const graphics = this.graphics;
    graphics.clear();
    this.floorTitle.setText(
      `${snapshot.floor}F・第${snapshot.tower.district}区画`,
    );

    graphics.fillStyle(0x07131c, 1);
    graphics.fillRect(0, 0, WIDTH, HEIGHT);
    graphics.fillStyle(0x0d2230, 1);
    graphics.fillRect(0, 58, WIDTH, 86);
    graphics.fillStyle(0x183241, 1);
    graphics.fillRect(0, 144, WIDTH, FLOOR_Y - 144);

    this.drawTower(graphics);
    this.drawEnemy(graphics, snapshot);
    this.drawParty(graphics, snapshot);

    for (const effect of this.effects) {
      this.drawEffect(graphics, effect, time);
    }

    if (snapshot.status === 'paused') {
      graphics.fillStyle(0x041018, 0.76);
      graphics.fillRoundedRect(100, 138, 190, 76, 16);
      graphics.lineStyle(2, 0xd5bd82, 0.9);
      graphics.strokeRoundedRect(100, 138, 190, 76, 16);
      graphics.fillStyle(0xd5bd82, 1);
      graphics.fillRect(174, 158, 12, 36);
      graphics.fillRect(204, 158, 12, 36);
    }
  }

  private drawTower(graphics: Phaser.GameObjects.Graphics): void {
    graphics.fillStyle(0x223f4c, 1);
    graphics.fillRect(0, 68, 20, FLOOR_Y - 68);
    graphics.fillRect(WIDTH - 20, 68, 20, FLOOR_Y - 68);

    graphics.lineStyle(1, 0x315766, 0.75);
    for (let y = 82; y < FLOOR_Y; y += 34) {
      graphics.beginPath();
      graphics.moveTo(20, y);
      graphics.lineTo(WIDTH - 20, y);
      graphics.strokePath();
    }

    graphics.fillStyle(0x7a6246, 1);
    graphics.fillRect(0, FLOOR_Y, WIDTH, 18);
    graphics.fillStyle(0x4c392c, 1);
    graphics.fillRect(0, FLOOR_Y + 18, WIDTH, HEIGHT - FLOOR_Y - 18);

    graphics.fillStyle(0xd8b267, 0.12);
    graphics.fillCircle(WIDTH / 2, 142, 78);
    graphics.lineStyle(2, 0xd8b267, 0.22);
    graphics.strokeCircle(WIDTH / 2, 142, 78);
  }

  private drawParty(
    graphics: Phaser.GameObjects.Graphics,
    snapshot: BattleSnapshot,
  ): void {
    const positions = [
      { x: 224, y: 228 },
      { x: 278, y: 240 },
      { x: 326, y: 218 },
      { x: 346, y: 256 },
    ];

    snapshot.cats.forEach((cat, index) => {
      const position = positions[index];
      if (!position) return;

      const alpha = cat.alive ? 1 : 0.28;
      const color = roleColor[cat.role];

      graphics.fillStyle(0x041018, 0.35 * alpha);
      graphics.fillEllipse(position.x, FLOOR_Y - 3, 48, 12);

      graphics.fillStyle(color, alpha);
      graphics.fillRoundedRect(position.x - 14, position.y, 28, 42, 10);
      graphics.fillCircle(position.x, position.y - 2, 18);
      graphics.fillTriangle(
        position.x - 15,
        position.y - 12,
        position.x - 4,
        position.y - 23,
        position.x - 2,
        position.y - 7,
      );
      graphics.fillTriangle(
        position.x + 15,
        position.y - 12,
        position.x + 4,
        position.y - 23,
        position.x + 2,
        position.y - 7,
      );

      graphics.fillStyle(0x08131a, alpha);
      graphics.fillCircle(position.x - 6, position.y - 4, 2);
      graphics.fillCircle(position.x + 6, position.y - 4, 2);

      this.drawHpBar(
        graphics,
        position.x - 22,
        position.y - 34,
        44,
        ratioForDisplay(cat.hp, cat.maxHp),
        0x75c58a,
      );
    });
  }

  private drawEnemy(
    graphics: Phaser.GameObjects.Graphics,
    snapshot: BattleSnapshot,
  ): void {
    const enemy = snapshot.enemy;
    const alpha = enemy.alive ? 1 : 0.18;
    const x = 82;
    const y = 236;

    graphics.fillStyle(0x02080d, 0.45 * alpha);
    graphics.fillEllipse(x, FLOOR_Y - 3, 62, 13);

    graphics.fillStyle(0x59616a, alpha);
    graphics.fillEllipse(x, y + 16, 54, 42);
    graphics.fillCircle(x - 5, y - 2, 23);
    graphics.fillTriangle(x - 24, y - 8, x - 14, y - 27, x - 6, y - 8);
    graphics.fillTriangle(x + 13, y - 10, x + 27, y - 22, x + 21, y);

    graphics.fillStyle(0xf0c468, alpha);
    graphics.fillCircle(x - 13, y - 4, 3);
    graphics.fillCircle(x + 1, y - 5, 3);

    this.drawHpBar(
      graphics,
      42,
      186,
      80,
      ratioForDisplay(enemy.hp, enemy.maxHp),
      0xd16f6f,
    );
  }

  private drawHpBar(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    ratio: number,
    color: number,
  ): void {
    graphics.fillStyle(0x02070b, 0.78);
    graphics.fillRoundedRect(x, y, width, 7, 3);
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(
      x + 1,
      y + 1,
      Math.max(0, (width - 2) * ratio),
      5,
      2,
    );
  }

  private drawEffect(
    graphics: Phaser.GameObjects.Graphics,
    effect: VisualEffect,
    time: number,
  ): void {
    const age = time - effect.createdAt;
    const progress = Math.min(1, age / 620);
    const alpha = 1 - progress;
    const actor = this.positionFor(effect.actorId);
    const target = this.positionFor(effect.targetId);

    if (effect.type === 'attack' && actor && target) {
      graphics.lineStyle(4, 0xf0d28c, alpha);
      graphics.beginPath();
      graphics.moveTo(actor.x, actor.y);
      graphics.lineTo(target.x, target.y);
      graphics.strokePath();
    }

    if (effect.type === 'hit' && target) {
      graphics.lineStyle(3, 0xffffff, alpha);
      graphics.strokeCircle(target.x, target.y, 8 + progress * 24);
    }

    if (effect.type === 'heal' && target) {
      graphics.lineStyle(3, 0x79d5a4, alpha);
      graphics.strokeCircle(target.x, target.y, 10 + progress * 22);
      graphics.beginPath();
      graphics.moveTo(target.x - 8, target.y);
      graphics.lineTo(target.x + 8, target.y);
      graphics.moveTo(target.x, target.y - 8);
      graphics.lineTo(target.x, target.y + 8);
      graphics.strokePath();
    }

    if (effect.type === 'defeat') {
      graphics.fillStyle(0xf2cf79, alpha * 0.32);
      graphics.fillCircle(82, 236, 38 + progress * 54);
    }

    if (effect.type === 'reward') {
      graphics.fillStyle(0xf0c468, alpha);
      graphics.fillCircle(132 + progress * 56, 212 - progress * 32, 6);
      graphics.fillCircle(142 + progress * 52, 224 - progress * 42, 4);
    }
  }

  private positionFor(id?: string): { x: number; y: number } | undefined {
    if (!id) return undefined;

    if (id.startsWith('enemy.') || id.startsWith('tower.boss.')) {
      return { x: 82, y: 236 };
    }

    const positions: Record<string, { x: number; y: number }> = {
      'character.launch.001': { x: 224, y: 228 },
      'character.launch.002': { x: 278, y: 240 },
      'character.launch.003': { x: 326, y: 218 },
      'character.launch.004': { x: 346, y: 256 },
    };

    return positions[id];
  }
}
