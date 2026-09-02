import { PhaserStage } from './PhaserStage';
import { battleRuntime } from './game/runtime';
import { useBattleSnapshot } from './useBattleSnapshot';

const formatSeconds = (milliseconds: number): string =>
  `${Math.floor(milliseconds / 1_000)}秒`;

export const App = () => {
  const snapshot = useBattleSnapshot();
  const enemyRatio =
    snapshot.enemy.maxHp > 0 ? snapshot.enemy.hp / snapshot.enemy.maxHp : 0;

  return (
    <main className="app-shell">
      <header className="top-hud" data-testid="top-hud">
        <div>
          <p className="eyebrow">CAT'S TOWER / V2 BOOTSTRAP</p>
          <h1>第1区画</h1>
        </div>
        <div className="resource-stack" aria-label="現在の資源">
          <span>
            <b>{snapshot.coins}</b>
            <small>coin</small>
          </span>
          <span>
            <b>Lv.{snapshot.level}</b>
            <small>party</small>
          </span>
        </div>
      </header>

      <section className="combat-card" aria-label="自動戦闘">
        <div className="enemy-strip">
          <div>
            <span className="enemy-kicker">WAVE {snapshot.wave}</span>
            <strong>灰ネズミ</strong>
          </div>
          <div className="enemy-health" aria-label={`敵HP ${snapshot.enemy.hp}/${snapshot.enemy.maxHp}`}>
            <span
              data-testid="enemy-health-fill"
              style={{ width: `${Math.max(0, Math.min(1, enemyRatio)) * 100}%` }}
            />
          </div>
          <b>{snapshot.enemy.hp}/{snapshot.enemy.maxHp}</b>
        </div>

        <PhaserStage />

        <div className="event-strip" aria-live="polite" data-testid="last-event">
          <span>{snapshot.lastEvent.label}</span>
          <small>{formatSeconds(snapshot.elapsedMs)}・撃破 {snapshot.kills}</small>
        </div>
      </section>

      <section className="party-panel" aria-label="編成中の4体">
        {snapshot.cats.map((cat) => (
          <article key={cat.id} className="party-chip">
            <span className={`role-mark role-${cat.role}`} aria-hidden="true" />
            <div>
              <strong>{cat.name}</strong>
              <small>{cat.role}</small>
            </div>
            <b>{cat.hp}/{cat.maxHp}</b>
          </article>
        ))}
      </section>

      <section className="controls" aria-label="検証用操作">
        <button
          type="button"
          onClick={() =>
            snapshot.status === 'paused'
              ? battleRuntime.resume()
              : battleRuntime.pause()
          }
        >
          {snapshot.status === 'paused' ? '戦闘を再開' : '一時停止'}
        </button>
        <button type="button" onClick={() => battleRuntime.restart()}>
          同じseedで再開
        </button>
      </section>

      <footer>
        <b>FIRST PLAYABLE BOOTSTRAP</b>
        <span>仮図形・仮数値 / NOT PRODUCTION</span>
      </footer>
    </main>
  );
};
