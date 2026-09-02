import * as Phaser from 'phaser';
import { BattleScene } from './BattleScene';

export const createGame = (parent: string): Phaser.Game =>
  new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: 390,
    height: 360,
    backgroundColor: '#07131c',
    transparent: false,
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 390,
      height: 360,
    },
    scene: [BattleScene],
  });
