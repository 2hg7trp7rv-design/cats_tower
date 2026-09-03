/// <reference types="vite/client" />

import type {
  BattleEngineOptions,
  BattleSnapshot,
} from '@cats-tower/domain';

declare global {
  interface Window {
    __CATS_TOWER_V2__: {
      readonly version: string;
      getSnapshot: () => BattleSnapshot;
      restart: (
        seed?: string | number,
        options?: BattleEngineOptions,
      ) => BattleSnapshot;
      levelUp: () => BattleSnapshot;
      pause: () => BattleSnapshot;
      resume: () => BattleSnapshot;
      advanceForTest: (milliseconds: number) => BattleSnapshot;
    };
  }
}

export {};
