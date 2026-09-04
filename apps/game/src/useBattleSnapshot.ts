import { useEffect, useState } from 'react';
import type { BattleSnapshot } from '@cats-tower/domain';
import { battleRuntime } from './game/runtime';

export const useBattleSnapshot = (): BattleSnapshot => {
  const [snapshot, setSnapshot] = useState(() => battleRuntime.getSnapshot());

  useEffect(
    () =>
      battleRuntime.subscribe(() => {
        setSnapshot(battleRuntime.getSnapshot());
      }),
    [],
  );

  return snapshot;
};
