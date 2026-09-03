import {
  displayInteger,
  ratioForDisplay,
  type CatRole,
} from '@cats-tower/domain';
import { PhaserStage } from './PhaserStage';
import { battleRuntime } from './game/runtime';
import { useBattleSnapshot } from './useBattleSnapshot';

const formatSeconds = (milliseconds: number): string =>
  `${Math.floor(milliseconds / 1_000)}秒`;

const roleLabel: Record<CatRole, string> = {
  'frontline-control': '前衛・制御',
  'ranged-anti-air': '遠距離・対空',
  'healing-support': '回復・支援',
  'runner-backline-disruption': '走者・後衛妨害',
};

export const App = () => {
  const snapshot = useBattleSnapshot();
  const enemyRatio = ratioForDisplay(snapshot.enemy.hp, snapshot.enemy.maxHp);
  const floorLabel = `${displayInteger(snapshot.floor)}F`;

  return (
    <main className="app-shell">
      <header className="top-hud" data-testid="top-hud">
        <div>
          <p className="eyebrow">CAT'S TOWER / CANONICAL V2 BOOTSTRAP</p>
          <h1>{floorLabel}・第{snapshot.tower.district}区画</h1>
        </div>
        <div className="resource-stack" aria-label="現在の資源">
          <span>
            <b>{displayInteger(snapshot.coins)}</b>
            <small>run coin</small>
          </span>
          <span>
            <b>Lv.{displayInteger(snapshot.partyLevel)}</b>
            <small>party</small>
          </span>
        </div>
      </header>

      <section className="combat-card" aria-label="自動戦闘">
        <div className="enemy-strip">
          <div>
            <span className="enemy-kicker">
              {floorLabel} / {snapshot.tower.boss.kind.toUpperCase()}
            </span>
            <strong>{snapshot.enemy.name}</strong>
          </div>
          <div
            className="enemy-health"
            aria-label={`敵HP ${snapshot.enemy.hp}/${snapshot.enemy.maxHp}`}
          >
            <span
              data-testid="enemy-health-fill"
              style={{ width: `${enemyRatio * 100}%` }}
            />
          </div>
          <b>
            {displayInteger(snapshot.enemy.hp)}/
            {displayInteger(snapshot.enemy.maxHp)}
          </b>
        </div>

        <PhaserStage />

        <div className="event-strip" aria-live="polite" data-testid="last-event">
          <span>{snapshot.lastEvent.label}</span>
          <small>
            {formatSeconds(snapshot.elapsedMs)}・撃破 {displayInteger(snapshot.kills)}
          </small>
        </div>
      </section>

      <section className="party-panel" aria-label="編成中の4体">
        {snapshot.cats.map((cat) => (
          <article key={cat.id} className="party-chip" data-role={cat.role}>
            <span className={`role-mark role-${cat.role}`} aria-hidden="true" />
            <div>
              <strong>{cat.name}</strong>
              <small>{roleLabel[cat.role]}</small>
            </div>
            <b>
              {displayInteger(cat.hp)}/{displayInteger(cat.maxHp)}
            </b>
          </article>
        ))}
      </section>

      <section className="controls" aria-label="検証用操作">
        <button
          type="button"
          disabled={!snapshot.canLevelUp}
          onClick={() => battleRuntime.levelUp()}
          aria-label={`パーティをレベルアップ。必要coin ${snapshot.nextLevelCost}`}
        >
          Lvアップ {displayInteger(snapshot.nextLevelCost)}
        </button>
        <button
          type="button"
          onClick={() =>
            snapshot.status === 'paused'
              ? battleRuntime.resume()
              : battleRuntime.pause()
          }
        >
          {snapshot.status === 'paused' ? '戦闘再開' : '一時停止'}
        </button>
        <button type="button" onClick={() => battleRuntime.restart()}>
          同じseed
        </button>
      </section>

      <footer>
        <b>CANONICAL SOURCE BOUND</b>
        <span>candidate-v3 / engine-v2 / combat値は仮</span>
      </footer>
    </main>
  );
};
