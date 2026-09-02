import { useLayoutEffect, useRef } from 'react';
import type * as Phaser from 'phaser';
import { createGame } from './game/createGame';

export const PhaserStage = () => {
  const gameRef = useRef<Phaser.Game | null>(null);

  useLayoutEffect(() => {
    if (!gameRef.current) {
      gameRef.current = createGame('game-container');
    }

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div id="game-container" data-testid="game-container" />;
};
