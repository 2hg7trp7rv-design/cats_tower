/* =========================================================================
 * Cat's Tower — 戦闘プロトタイプ (kimiブランチ)
 * game-core.js : 戦闘・進行シミュレーション (描画・DOM・音に依存しない)
 *
 * 設計:
 *   - 固定小数点なしの秒ベース tick。app.js が requestAnimationFrame から
 *     update(dt) を呼ぶ。Node からも require してバランス検証できる。
 *   - 複数敵・レーン・役割ターゲティングを持つデータ構造 (MASTER_SPEC §6.5)。
 *     単体敵のHP差し替え方式は使わない。
 *   - 攻撃は 予備動作(windup) → 接触/弾着 → ダメージ確定 の順に状態遷移し、
 *     命中瞬間にイベントを積む。app.js が音・数字・反動・ヒットストップを
 *     ±50ms 内に同期させる (§6.2)。
 *   - 画面へ出す全ての出来事は this.events に {type, ...} で積む。
 * ========================================================================= */
(function (global) {
  'use strict';

  const DATA = (typeof module !== 'undefined' && module.exports)
    ? require('./game-data.js')
    : global.GAME_DATA;

  const { CATS, HELPERS, ENEMIES, SHOPS, RELICS, FLOORS, BALANCE, DIAGNOSIS } = DATA;

  let UID = 1;

  /* ------------------------------------------------------------------ */
  class Game {
    constructor() {
      this.events = [];
      this.resetRun();
    }

    emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }
    drainEvents() { const e = this.events; this.events = []; return e; }

    /* ---------------- 周回リセット ---------------- */
    resetRun() {
      const B = BALANCE;
      this.time = 0;
      this.hitstop = 0;
      this.mode = 'title';           // title | battle | conquest | choice | defeat | cleared
      this.floor = 1;
      this.coins = 30;
      this.upgrades = { atk: 0, hp: 0, bell: 0 };
      this.shops = {};               // floorNum -> shopId
      this.relic = null;
      this.unlocked = { mugi: true, luna: false, toto: false, kohaku: false };
      this.lunaProgress = 0;         // 補給箱 0/3
      this.kohaku = { shopKinds: false, deliveries: 0, ledgerFirst: false, done: false, unlocked: false };
      this.lunaSnipePending = false;
      this.cats = [];                // 出撃中ユニット (名前付き + 増援)
      this.enemies = [];
      this.projectiles = [];
      this.deliveries = [];
      this.shopTimers = {};          // floorNum -> 次の配送まで
      this.waveIdx = 0;
      this.pendingSpawns = [];
      this.waveBreakT = 0;
      this.bellCd = 0;
      this.rallyT = 0;
      this.bellLockT = 0;            // ボス第3形態の入口封鎖
      this.conquestT = 0;
      this.conquestPhase = '';
      this.pendingChoice = null;     // {type:'shop'|'relic'|'unlock', ...}
      this.defeatInfo = null;
      this.dawnNoticed = false;
      this.floorKillOrder = [];
      this.metrics = this.freshMetrics();
      this.maxFloorReached = 1;
      this.enterFloor(1, true);
      this.mode = 'title'; // enterFloor が battle にするのでタイトルへ戻す
    }

    freshMetrics() {
      return { dmgFlying: 0, dmgShielded: 0, supportCasts: 0, breachT: 0, helperUpT: 0, totalT: 0, catHpLost: 0, healed: 0 };
    }

    /* ---------------- ステータス計算 ---------------- */
    atkMult() {
      let m = 1 + BALANCE.upgrades.atk.perLevel * this.upgrades.atk;
      if (this.relic === 'soot_claw') m *= 1.25;
      return m;
    }
    hpMult() { return 1 + BALANCE.upgrades.hp.perLevel * this.upgrades.hp; }
    helperSlotMax() {
      let s = BALANCE.bell.maxHelpers + this.upgrades.bell;
      if (Object.values(this.shops).includes('guild')) s += BALANCE.bell.guildBonusSlots;
      return s;
    }
    hasShop(id) { return Object.values(this.shops).includes(id); }
    shopKinds() { return new Set(Object.values(this.shops)).size; }
    floorDef(n) { return FLOORS[n || this.floor]; }

    /* ---------------- 階への入場 ---------------- */
    enterFloor(n, first) {
      this.floor = n;
      this.maxFloorReached = Math.max(this.maxFloorReached, n);
      this.mode = 'battle';
      this.enemies = [];
      this.projectiles = [];
      this.pendingSpawns = [];
      this.waveIdx = 0;
      this.waveBreakT = 0;
      this.floorKillOrder = [];
      this.bellLockT = 0;
      this.hitstop = 0;
      this.metrics = this.freshMetrics();
      this.totoDanger = false;

      const def = this.floorDef(n);
      // 9F: 直近構成でエリートを切替 (爪工房あり→重装、なし→指揮)
      let waves = def.waves;
      if (def.eliteChoice) waves = this.hasShop('claw_forge') ? def.wavesAlt : def.waves;
      this._scheduleWave(waves[0], 0.4);

      // 名前付き猫を入口から入場させる (§6.1: 見た目だけ固定出現させない)
      this.cats = this.cats.filter(c => c.named && this.unlocked[c.defId]);
      const W = BALANCE.world;
      const NAMED_LANE = { mugi: 1, luna: 0, toto: 2, kohaku: 0 };
      Object.keys(CATS).forEach(id => {
        if (!this.unlocked[id]) return;
        let c = this.cats.find(u => u.defId === id);
        if (!c) { c = this._makeCat(id, true); this.cats.push(c); }
        c.hp = c.maxHp; c.faintT = 0; c.dead = false;
        c.x = W.entryX; c.state = 'enter'; c.stateT = 0;
        c.lane = NAMED_LANE[id];
        c.homeX = this._homeXFor(c);
        c.targetUid = null; c.attackCd = 0.5;
      });
      // 増援は階をまたがない
      this.cats = this.cats.filter(c => c.named);

      // 配送タイマー初期化 (初回入場時のみ)
      if (first) this._resetShopTimers();
      this.emit('floor-enter', { floor: n, def });
    }

    _homeXFor(cat) {
      const W = BALANCE.world;
      if (cat.role === 'vanguard') return 168;
      if (cat.role === 'runner') return 150;
      return 96 + cat.lane * 14; // ranged / healer は後方
    }

    _resetShopTimers() {
      this.shopTimers = {};
      Object.keys(this.shops).forEach(f => {
        this.shopTimers[f] = BALANCE.deliveries.interval * 0.5;
      });
    }

    /* ---------------- ユニット生成 ---------------- */
    _makeCat(defId, named) {
      const d = named ? CATS[defId] : HELPERS[defId];
      const u = {
        uid: UID++, side: 'cat', defId, named: !!named,
        name: d.name, role: d.role,
        x: BALANCE.world.entryX, lane: 1,
        maxHp: Math.round(d.hp * this.hpMult() * (!named && this.relic === 'resonant_bell' ? 1.25 : 1)),
        atk: d.atk, heal: d.heal || 0,
        interval: d.interval, range: d.range, speed: d.speed, windup: d.windup,
        projectile: d.projectile || null,
        canHitFlying: d.canHitFlying || 'never',
        state: 'enter', stateT: 0, attackCd: 0, attackCount: 0,
        targetUid: null, kb: 0, flash: 0, faintT: 0, dead: false,
        buffT: 0, shieldUp: false, missT: 0, homeX: 0
      };
      u.hp = u.maxHp;
      return u;
    }

    _makeEnemy(defId, lane, tag) {
      const d = ENEMIES[defId];
      const f = this.floor - 1;
      const isBoss = !!d.boss;
      const hpScale = Math.pow(BALANCE.floors.hpScale, f);
      const atkScale = Math.pow(BALANCE.floors.atkScale, f);
      const u = {
        uid: UID++, side: 'enemy', defId, tag: tag || null,
        name: d.name, role: d.role,
        x: BALANCE.world.enemyEntryX + 24, lane,
        maxHp: Math.round(d.hp * hpScale), atk: Math.round(d.atk * atkScale),
        interval: d.interval, range: d.range, speed: d.speed, windup: d.windup,
        flying: d.flying, altitude: d.altitude || 0, swoop: d.swoop || false,
        swooping: false, projectile: d.projectile || null,
        passThrough: d.passThrough || false,
        shieldReduce: d.shieldReduce || 0, shieldBroken: 0,
        summon: d.summon || null, buffAlly: d.buffAlly || null, debuff: d.debuff || null,
        pushback: d.pushback || null, reward: d.reward,
        state: 'enter', stateT: 0, attackCd: 1.0, attackCount: 0,
        targetUid: null, kb: 0, flash: 0, dead: false,
        summonT: 0, buffT: 0, buffedNext: false, channelT: 0,
        boss: isBoss ? {
          phase: 0, phaseT: 0, signatureSeen: false, invulnT: 0,
          landingT: 0, landCycleT: 0, sealT: 0, stealT: 0, def: d.boss
        } : null
      };
      u.hp = u.maxHp;
      if (isBoss) { u.x = BALANCE.world.enemyEntryX - 30; u.state = 'boss-intro'; u.stateT = 0; }
      return u;
    }

    _scheduleWave(wave, baseDelay) {
      wave.forEach(s => {
        this.pendingSpawns.push({ defId: s.e, lane: s.lane, tag: s.tag, at: this.time + baseDelay + (s.delay || 0) });
      });
    }

    /* ---------------- 呼び鈴 ---------------- */
    bellReady() { return this.bellCd <= 0 && this.bellLockT <= 0 && (this.mode === 'battle'); }
    bellState() {
      if (this.bellLockT > 0) return 'locked';
      if (this.bellCd > 0) return 'cooldown';
      const helpers = this.cats.filter(c => !c.named && !c.dead).length;
      if (helpers >= this.helperSlotMax()) return 'full';
      return 'ready';
    }

    pressBell() {
      if (this.mode !== 'battle') return { result: 'inactive' };
      if (this.bellLockT > 0) { this.emit('bell-denied', { reason: '入口が封鎖されている' }); return { result: 'locked' }; }
      if (this.bellCd > 0) return { result: 'cooldown' };
      let cd = BALANCE.bell.cooldown;
      if (this.relic === 'resonant_bell') cd *= 0.7;
      this.bellCd = cd;

      const helpers = this.cats.filter(c => !c.named && !c.dead).length;
      if (helpers >= this.helperSlotMax()) {
        // 満員時は号令へ変換 (§5.1: 主操作を無反応にしない)
        this.rallyT = BALANCE.bell.rallyDuration;
        this.emit('rally', { duration: BALANCE.bell.rallyDuration });
        return { result: 'rally' };
      }
      const role = this._pickHelperRole();
      const u = this._makeCat(role, false);
      // 走行距離30〜45%を650〜1000msで (BALANCE.run, MASTER_SPEC §6.1)
      const W = BALANCE.world;
      const dist = W.width * (BALANCE.run.distanceMin + Math.random() * (BALANCE.run.distanceMax - BALANCE.run.distanceMin));
      const t = BALANCE.run.timeMin + Math.random() * (BALANCE.run.timeMax - BALANCE.run.timeMin);
      u.speed = Math.max(u.speed, dist / t);
      u.lane = [2, 0, 1][helpers % 3];
      u.x = W.entryX;
      u.state = 'enter';
      this.cats.push(u);
      this.emit('bell-ring', { role });
      this.emit('helper-spawn', { uid: u.uid, role });
      return { result: 'spawn', role };
    }

    _pickHelperRole() {
      const w = Object.assign({}, BALANCE.helperWeights.base);
      const hasFlying = this.enemies.some(e => !e.dead && e.flying);
      const hasShield = this.enemies.some(e => !e.dead && e.shieldReduce > 0);
      const swarm = this.enemies.filter(e => !e.dead).length >= 3;
      if (hasFlying) Object.assign(w, this._mergeW(w, BALANCE.helperWeights.vsFlying));
      if (hasShield) Object.assign(w, this._mergeW(w, BALANCE.helperWeights.vsShield));
      if (swarm) Object.assign(w, this._mergeW(w, BALANCE.helperWeights.vsSwarm));
      let total = 0; Object.values(w).forEach(v => total += v);
      let r = Math.random() * total;
      for (const k of Object.keys(w)) { r -= w[k]; if (r <= 0) return k; }
      return 'guard';
    }
    _mergeW(base, add) { const o = {}; Object.keys(add).forEach(k => o[k] = (base[k] || 0) + add[k]); return o; }

    /* ---------------- 強化 ---------------- */
    upgradeCost(kind) {
      const u = BALANCE.upgrades[kind];
      const lv = this.upgrades[kind];
      if (u.max && lv >= u.max) return null;
      return Math.round(u.baseCost * Math.pow(u.costMult, lv));
    }
    buyUpgrade(kind) {
      const cost = this.upgradeCost(kind);
      if (cost == null || this.coins < cost) return false;
      this.coins -= cost;
      this.upgrades[kind]++;
      // HP強化は現在の猫へ即時反映 (強化結果を戦闘画面で読めるように)
      if (kind === 'hp') {
        this.cats.forEach(c => {
          const ratio = c.hp / c.maxHp;
          c.maxHp = Math.round(c.maxHp * (1 + BALANCE.upgrades.hp.perLevel));
          c.hp = Math.round(c.maxHp * ratio);
        });
      }
      this.emit('upgrade', { kind, level: this.upgrades[kind] });
      return true;
    }

    /* ---------------- 店舗・遺物選択 ---------------- */
    chooseShop(shopId) {
      const f = this._choiceFloor || this.floor;
      this.shops[f] = shopId;
      this.shopTimers[f] = 2.5; // 最初の配送を早めに見せる
      this.emit('shop-placed', { floor: f, shopId });
      this._updateKohakuShopCondition();
      this.pendingChoice = null;
      this._afterChoice();
    }
    skipShopChoice() {
      this.emit('shop-skipped', { floor: this._choiceFloor || this.floor });
      this.pendingChoice = null;
      this._afterChoice();
    }
    chooseRelic(id) {
      this.relic = id;
      this.emit('relic-chosen', { relic: id });
      this.pendingChoice = null;
      this._afterChoice();
    }
    _updateKohakuShopCondition() {
      if (this.shopKinds() >= BALANCE.kohaku.shopKinds) this.kohaku.shopKinds = true;
    }

    /* ---------------- メイン更新 ---------------- */
    update(dt) {
      this.time += dt;
      // ヒットストップ: 50〜80ms シミュレーションを凍結 (§6.2)
      if (this.hitstop > 0) { this.hitstop -= dt; return; }

      if (this.bellCd > 0) this.bellCd -= dt;
      if (this.bellLockT > 0) this.bellLockT -= dt;
      if (this.rallyT > 0) this.rallyT -= dt;

      if (this.mode === 'battle') this._tickBattle(dt);
      else if (this.mode === 'conquest') this._tickConquest(dt);

      this._tickDeliveries(dt);
      this._tickProjectiles(dt);
      this.metrics.totalT += dt;
    }

    _tickBattle(dt) {
      const m = this.metrics;
      // 出現予約
      for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
        const s = this.pendingSpawns[i];
        if (this.time >= s.at) {
          this.pendingSpawns.splice(i, 1);
          const e = this._makeEnemy(s.defId, s.lane, s.tag);
          this.enemies.push(e);
          this.emit('enemy-spawn', { uid: e.uid, defId: s.defId, tag: s.tag });
          // ルナ解放直後の一撃演出 (FLOORS §4.2)
          if (this.lunaSnipePending && s.defId === 'scrap_crow' && this.unlocked.luna) {
            this.lunaSnipePending = false;
            this._applyDamage(e, BALANCE.lunaSnipeDamage, { srcUid: 0, snipe: true });
            this.emit('luna-snipe', { uid: e.uid });
          }
        }
      }

      const liveCats = this.cats.filter(c => !c.dead && c.faintT <= 0);
      const liveEnemies = this.enemies.filter(e => !e.dead);
      m.helperUpT += liveCats.filter(c => !c.named).length > 0 ? dt : 0;

      for (const c of liveCats) this._tickCat(c, dt);
      for (const e of liveEnemies) this._tickEnemy(e, dt);

      // 気絶猫の復帰
      for (const c of this.cats) {
        if (c.named && c.faintT > 0) {
          c.faintT -= dt * (this.hasShop('clinic') ? 1.4 : 1);
          if (c.faintT <= 0) {
            c.hp = Math.round(c.maxHp * BALANCE.cats.reviveHpRatio);
            c.state = 'enter'; c.x = BALANCE.world.entryX;
            this.emit('cat-revive', { uid: c.uid, defId: c.defId });
          }
        }
      }
      // 死骸掃除
      this.cats = this.cats.filter(c => !c.dead || c.named);
      this.enemies = this.enemies.filter(e => !e.removeFlag);

      // 敗北判定: 敵が入口突破
      const breach = liveEnemies.some(e => e.x <= BALANCE.world.breachX && e.state !== 'enter');
      if (breach) { this._onDefeat(); return; }
      // 5F: トト危険表示
      if (this.floor === 5) {
        this.totoDanger = liveEnemies.some(e => e.x < 150);
      }

      // ウェーブ進行
      if (liveEnemies.length === 0 && this.pendingSpawns.length === 0) {
        const def = this.floorDef();
        const waves = def.eliteChoice ? (this.hasShop('claw_forge') ? def.wavesAlt : def.waves) : def.waves;
        if (this.waveIdx + 1 < waves.length) {
          if (this.waveBreakT <= 0) {
            this.waveBreakT = BALANCE.floors.waveInterval;
            this.emit('wave-clear', { next: this.waveIdx + 2, total: waves.length });
            // トトのウェーブ間全体小回復 (§4.3)
            const toto = this.cats.find(c => c.defId === 'toto' && !c.dead && c.faintT <= 0);
            if (toto) {
              this.cats.forEach(c => { if (!c.dead && c.faintT <= 0) this._heal(c, Math.round(c.maxHp * 0.1)); });
              this.emit('toto-waveheal', {});
            }
          }
          this.waveBreakT -= dt;
          if (this.waveBreakT <= 0) {
            this.waveIdx++;
            this._scheduleWave(waves[this.waveIdx], 0.2);
            this.emit('wave-start', { wave: this.waveIdx + 1, total: waves.length });
          }
        } else {
          this._onConquest();
        }
      }
    }

    /* ---------------- 猫の行動 ---------------- */
    _tickCat(c, dt) {
      if (c.flash > 0) c.flash -= dt;
      if (c.kb > 0) c.kb = Math.max(0, c.kb - dt * 120);
      if (c.missT > 0) c.missT -= dt;
      if (c.buffT > 0) c.buffT -= dt;
      c.stateT += dt;
      if (c.attackCd > 0) c.attackCd -= dt;

      const haste = (this.rallyT > 0 ? 1 + BALANCE.bell.rallyHaste : 1) * (c.hasteFood ? 1.15 : 1);

      switch (c.state) {
        case 'enter': {
          // 入口から担当位置まで実際に走る
          const stopX = c.named ? c.homeX : this._helperStopX(c);
          c.x += c.speed * dt;
          if (c.x >= stopX) { c.x = stopX; c.state = 'combat'; c.stateT = 0; }
          break;
        }
        case 'combat': {
          const target = this._catTarget(c);
          if (!target) {
            // 標的なし: 名前付きは担当位置へ戻る
            const home = c.named ? c.homeX : this._helperStopX(c);
            if (Math.abs(c.x - home) > 4) c.x += Math.sign(home - c.x) * c.speed * 0.6 * dt;
            break;
          }
          c.targetUid = target.uid;
          // 同じ敵に近接で群がる猫は縦列を組む (重なって判別不能にしない §3-3)
          let queue = 0;
          if (c.role === 'vanguard' || c.role === 'runner') {
            queue = this.cats.filter(o => o !== c && !o.dead && o.faintT <= 0 &&
              (o.role === 'vanguard' || o.role === 'runner') &&
              o.targetUid === target.uid && o.x > c.x).length;
          }
          const reach = c.range + this._unitHalfW(target) + (c.uid % 3) * 14 + queue * 44;
          const dist = target.x - c.x;
          if (c.role === 'healer') { this._catAttackCycle(c, target, dt, haste); break; }
          if (dist > reach) {
            c.x += c.speed * dt; // 接敵まで走る (接触前に攻撃判定を出さない)
          } else {
            this._catAttackCycle(c, target, dt, haste);
          }
          break;
        }
        case 'windup': {
          // 予備動作 (読める溜め)
          const w = c.windup / haste;
          if (c.stateT >= w) {
            c.state = 'combat'; c.stateT = 0;
            this._catStrike(c);
          }
          break;
        }
      }
    }

    _helperStopX(c) {
      if (c.role === 'ranged') return 108 + c.lane * 12;
      if (c.role === 'runner') return 150;
      return 172 + c.lane * 8;
    }

    _unitHalfW() { return 30; } // スプライト半身幅。接敵しつつ判別不能に重ならない距離

    _catTarget(c) {
      const es = this.enemies.filter(e => !e.dead && e.state !== 'enter');
      if (!es.length) return null;
      if (c.role === 'healer') {
        // 最もHP割合の低い味方
        let best = null, ratio = 1.01;
        this.cats.forEach(a => {
          if (a.dead || a.faintT > 0) return;
          const r = a.hp / a.maxHp;
          if (r < ratio) { ratio = r; best = a; }
        });
        return ratio < 0.999 ? best : null;
      }
      const hittable = es.filter(e => this._canHit(c, e));
      if (!hittable.length) return null;
      if (c.role === 'ranged') {
        const fly = hittable.filter(e => e.flying);
        if (fly.length) return fly.sort((a, b) => a.x - b.x)[0]; // 飛行優先
        const rear = hittable.filter(e => e.role === 'support' || e.role === 'elite');
        if (rear.length) return rear.sort((a, b) => b.x - a.x)[0];
        return hittable.sort((a, b) => a.x - b.x)[0];
      }
      if (c.role === 'runner') {
        // 前衛をすり抜け、最も危険度の高い後列へ
        const rear = hittable.filter(e => e.role === 'support' || e.role === 'elite' || (e.tag === 'ledger'));
        if (rear.length) return rear.sort((a, b) => b.x - a.x)[0];
        return hittable.sort((a, b) => b.x - a.x)[0];
      }
      // vanguard: 最も近い (x最小)
      return hittable.sort((a, b) => a.x - b.x)[0];
    }

    _canHit(c, e) {
      if (e.flying && !e.swooping) return c.canHitFlying === 'always';
      if (e.flying && e.swooping) return c.canHitFlying === 'always' || c.canHitFlying === 'swoop';
      return true;
    }

    _catAttackCycle(c, target, dt, haste) {
      if (c.attackCd > 0) return;
      c.state = 'windup'; c.stateT = 0;
      c.targetUid = target.uid;
      c.attackCd = c.interval / haste;
      c.attackCount++;
    }

    _catStrike(c) {
      const target = this.cats.find(u => u.uid === c.targetUid) || this.enemies.find(u => u.uid === c.targetUid);
      if (!target || target.dead) return;
      if (c.role === 'healer') {
        // 包帯を投げる (弾着で回復)
        this._spawnProjectile(c, target, 'bandage', c.heal);
        return;
      }
      // 煙コウモリの照準乱れ
      if (c.missT > 0 && Math.random() < 0.25) {
        this.emit('miss', { uid: c.uid, targetUid: target.uid });
        return;
      }
      const strong = c.attackCount % BALANCE.combat.strongEvery === 0;
      let dmg = Math.round(c.atk * this.atkMult() * (strong ? BALANCE.combat.strongMult : 1));
      if (c.forgeBuffT > 0) dmg = Math.round(dmg * 1.2);
      if (c.projectile) {
        this._spawnProjectile(c, target, c.projectile, dmg, strong);
      } else {
        this._applyDamage(target, dmg, { srcUid: c.uid, strong, melee: true, attacker: c });
        // ムギの盾構え (§4.1) / コハクの詠唱停止 (§4.4)
        if (c.defId === 'mugi' && c.attackCount % 4 === 0) { c.shieldUp = true; this.emit('shield-stance', { uid: c.uid }); }
        if ((c.defId === 'kohaku' || c.role === 'runner') && (target.channelT > 0 || (target.boss && target.boss.sealT > 0))) {
          target.channelT = 0;
          if (target.boss) target.boss.sealT = 0;
          if (target.boss && this.bellLockT > 0) this.bellLockT = 0;
          this.emit('interrupt', { uid: c.uid, targetUid: target.uid });
        }
        // 盾破砕 (爪工房/煤払いの爪/ランナー)
        if (target.shieldReduce > 0 && (this.hasShop('claw_forge') || this.relic === 'soot_claw' || c.role === 'runner')) {
          if (target.shieldBroken <= 0) { target.shieldBroken = 8; this.emit('shield-break', { uid: target.uid }); }
        }
      }
    }

    _spawnProjectile(src, target, kind, amount, strong) {
      this.projectiles.push({
        uid: UID++, kind, side: src.side,
        x0: src.x, x1: target.x, t: 0,
        dur: Math.max(0.18, Math.abs(target.x - src.x) / 480),
        targetUid: target.uid, amount, strong: !!strong, srcUid: src.uid,
        arc: kind === 'bandage' ? 26 : 34
      });
      this.emit('projectile-fire', { kind, srcUid: src.uid, targetUid: target.uid });
    }

    _tickProjectiles(dt) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.t += dt / p.dur;
        if (p.t >= 1) {
          this.projectiles.splice(i, 1);
          const target = this.cats.find(u => u.uid === p.targetUid) || this.enemies.find(u => u.uid === p.targetUid);
          if (!target || target.dead) continue;
          // 弾着時に初めて効果確定 (§6.2: 弾が届く前にHPを減らさない)
          if (p.kind === 'bandage') {
            this._heal(target, p.amount);
            this.emit('heal-hit', { uid: target.uid, amount: p.amount });
          } else {
            this._applyDamage(target, p.amount, { srcUid: p.srcUid, strong: p.strong });
          }
        }
      }
    }

    /* ---------------- 敵の行動 ---------------- */
    _tickEnemy(e, dt) {
      if (e.flash > 0) e.flash -= dt;
      if (e.kb > 0) e.kb = Math.max(0, e.kb - dt * 120);
      if (e.shieldBroken > 0) e.shieldBroken -= dt;
      e.stateT += dt;
      if (e.attackCd > 0) e.attackCd -= dt;

      if (e.boss) { this._tickBoss(e, dt); return; }

      switch (e.state) {
        case 'enter':
          e.x -= e.speed * dt;
          if (e.x <= BALANCE.world.enemyEntryX - 20) { e.state = 'combat'; e.stateT = 0; }
          break;
        case 'combat': {
          // 支援敵の詠唱/召集
          this._tickEnemySpecial(e, dt);
          const target = this._enemyTarget(e);
          if (!target) { e.x -= e.speed * dt; break; } // 猫がいなければ入口へ
          e.targetUid = target.uid;
          // 敵側も前列に殺到せず縦列を組む
          const equeue = this.enemies.filter(o => o !== e && !o.dead && !o.flying &&
            o.targetUid === target.uid && o.x < e.x).length;
          const reach = e.range + this._unitHalfW() + (e.uid % 3) * 14 + (e.flying ? 0 : equeue * 34);
          const dist = e.x - target.x;
          if (e.flying) {
            // 飛行敵: 射程内で降下(swoop)して攻撃、それ以外は高度維持
            if (dist <= reach) {
              e.swooping = true;
              if (e.attackCd <= 0) { e.state = 'windup'; e.stateT = 0; e.attackCd = e.interval; e.attackCount++; e.telegraph = e.attackCount % 3 === 0; }
            } else {
              e.swooping = false;
              e.x -= e.speed * dt;
            }
          } else if (dist > reach) {
            e.x -= e.speed * dt;
          } else if (e.attackCd <= 0) {
            e.state = 'windup'; e.stateT = 0; e.attackCd = e.interval; e.attackCount++;
            e.telegraph = e.attackCount % 3 === 0; // 強攻撃は読める予備動作
            if (e.telegraph) this.emit('telegraph', { uid: e.uid });
          }
          break;
        }
        case 'windup': {
          const w = e.telegraph
            ? Math.min(BALANCE.combat.telegraphMax, Math.max(BALANCE.combat.telegraphMin, e.windup * 1.8))
            : e.windup;
          if (e.stateT >= w) {
            e.state = 'combat'; e.stateT = 0;
            this._enemyStrike(e);
          }
          break;
        }
      }
    }

    _tickEnemySpecial(e, dt) {
      // 火花ヤモリ: 味方強化詠唱 (§6.6)
      if (e.buffAlly) {
        e.buffT += dt;
        if (e.buffT >= e.buffAlly.every * 0.6 && e.channelT <= 0) e.channelT = 0.8;
        if (e.channelT > 0) {
          e.channelT -= dt;
          if (e.channelT <= 0) {
            const allies = this.enemies.filter(a => !a.dead && a.uid !== e.uid);
            if (allies.length) {
              const a = allies.sort((x, y) => x.x - y.x)[0];
              a.buffedNext = true;
              this.metrics.supportCasts++;
              this.emit('enemy-buff', { srcUid: e.uid, targetUid: a.uid });
            }
            e.buffT = 0;
          }
        }
      }
      // 帳場フクロウ: 補充予約 (§7.1)
      if (e.summon) {
        e.summonT += dt;
        if (e.summonT >= e.summon.every) {
          e.summonT = 0;
          const moles = this.enemies.filter(a => !a.dead && a.defId === e.summon.enemy).length;
          if (moles < 2) {
            const s = this._makeEnemy(e.summon.enemy, (e.lane + 1) % 3, 'reinforcement');
            s.x = BALANCE.world.enemyEntryX + 10;
            this.enemies.push(s);
            this.metrics.supportCasts++;
            this.emit('enemy-summon', { srcUid: e.uid, defId: e.summon.enemy });
          }
        }
      }
    }

    _enemyTarget(e) {
      const cs = this.cats.filter(c => !c.dead && c.faintT <= 0);
      if (!cs.length) return null;
      if (e.passThrough || (e.flying && e.role === 'flying')) {
        // すり抜け/飛行: 最も後ろ (x最小) の猫を狙う
        return cs.sort((a, b) => a.x - b.x)[0];
      }
      if (e.role === 'support' || (e.role === 'elite' && e.summon)) {
        return cs.sort((a, b) => b.x - a.x)[0] || cs[0]; // 後列支援は最前の猫を牽制
      }
      return cs.sort((a, b) => b.x - a.x)[0]; // 最前列の猫
    }

    _enemyStrike(e) {
      const target = this.cats.find(u => u.uid === e.targetUid);
      if (!target || target.dead || target.faintT > 0) return;
      if (e.projectile) {
        const strong = !!e.telegraph;
        this._spawnProjectile(e, target, e.projectile, Math.round(e.atk * (e.buffedNext ? 1.8 : 1) * (strong ? 1.5 : 1)), strong);
        e.buffedNext = false;
        if (e.debuff) this._applySmokeDebuff(e);
        e.telegraph = false;
        return;
      }
      const strong = !!e.telegraph;
      let dmg = Math.round(e.atk * (e.buffedNext ? (e.buffAllyMult || 1.8) : 1) * (strong ? 1.5 : 1));
      e.buffedNext = false;
      e.telegraph = false;
      // ムギの盾構えで強攻撃を軽減
      if (target.shieldUp && strong) { dmg = Math.round(dmg * 0.35); target.shieldUp = false; this.emit('shield-block', { uid: target.uid }); }
      this._damageCat(target, dmg, { strong, srcUid: e.uid });
      // 黒羽番兵の押し戻し
      if (e.pushback && e.attackCount % e.pushback.every === 0) {
        this.cats.forEach(c => { if (!c.dead && c.faintT <= 0 && c.role !== 'healer') c.x = Math.max(BALANCE.world.entryX, c.x - e.pushback.amount); });
        this.emit('pushback', { uid: e.uid });
      }
    }

    _applySmokeDebuff(e) {
      this.cats.forEach(c => { if (!c.dead && c.faintT <= 0) c.missT = e.debuff.duration; });
      this.emit('smoke', { uid: e.uid, duration: e.debuff.duration });
    }

    /* ---------------- ボス (10F カゲツバサ 3形態) ---------------- */
    _tickBoss(e, dt) {
      const b = e.boss;
      b.phaseT += dt;
      const phaseDef = b.def.phases[b.phase];

      if (e.state === 'boss-intro') {
        if (e.stateT > 1.0) { e.state = 'combat'; e.stateT = 0; }
        return;
      }
      if (b.invulnT > 0) { b.invulnT -= dt; return; }

      // 形態移行判定: HP境界 + 最低時間 + 代表行動を1回見せる (§8.4)
      const hpRatio = e.hp / e.maxHp;
      if (b.phase < 2 && hpRatio <= phaseDef.hpTo && b.phaseT >= phaseDef.minTime && b.signatureSeen) {
        b.phase++;
        b.phaseT = 0; b.signatureSeen = false; b.invulnT = 1.3;
        e.flying = (b.phase === 1);
        e.swooping = false;
        e.state = 'combat'; e.stateT = 0;
        this.hitstop = BALANCE.combat.hitstopStrong;
        this.emit('boss-phase', { phase: b.phase, def: b.def.phases[b.phase] });
        return;
      }

      // 形態ごとの行動
      if (b.phase === 0) {
        e.flying = false;
        this._bossMelee(e, dt, { steal: true });
        if (b.phaseT > 3) b.signatureSeen = true;
      } else if (b.phase === 1) {
        e.flying = true;
        // 着地窓: 9秒ごとに3秒着地 (対空なしでも詰まない §8.2)
        b.landCycleT += dt;
        const inWindow = (b.landCycleT % 8) < 4;
        e.swooping = inWindow;
        // カラス召集
        b.summonT = (b.summonT || 0) + dt;
        if (b.summonT > 7) {
          b.summonT = 0;
          const crows = this.enemies.filter(a => !a.dead && a.defId === 'scrap_crow').length;
          if (crows < 2) {
            const c = this._makeEnemy('scrap_crow', (e.lane + 2) % 3, 'bossAdd');
            this.enemies.push(c);
            this.emit('enemy-summon', { srcUid: e.uid, defId: 'scrap_crow' });
          }
        }
        this._bossMelee(e, dt, {});
        if (b.summonT === 0 || b.phaseT > 4) b.signatureSeen = true;
      } else {
        e.flying = false; e.swooping = false;
        // 入口封鎖 (§8.3)
        b.sealCycleT = (b.sealCycleT || 0) + dt;
        if (b.sealCycleT > 12) {
          b.sealCycleT = 0;
          this.bellLockT = 4;
          b.sealT = 4;
          b.signatureSeen = true;
          this.emit('entry-seal', { duration: 4 });
        }
        if (b.sealT > 0) b.sealT -= dt;
        this._bossMelee(e, dt, {});
        if (b.phaseT > 4) b.signatureSeen = true;
      }
    }

    _bossMelee(e, dt, opts) {
      const target = this._enemyTarget(e);
      if (!target) return;
      const reach = e.range + this._unitHalfW();
      const dist = e.x - target.x;
      if (dist > reach && !e.flying) { e.x -= e.speed * dt; return; }
      if (e.flying && !e.swooping && dist > 200) { e.x -= e.speed * dt; return; }
      if (e.attackCd > 0) return;
      if (e.state !== 'windup') {
        e.state = 'windup'; e.stateT = 0; e.attackCd = e.interval; e.attackCount++;
        e.telegraph = e.attackCount % 3 === 0;
        if (e.telegraph) this.emit('telegraph', { uid: e.uid, boss: true });
      } else if (e.stateT >= (e.telegraph ? 0.7 : e.windup)) {
        e.state = 'combat'; e.stateT = 0;
        const strong = !!e.telegraph; e.telegraph = false;
        let dmg = Math.round(e.atk * (strong ? 1.6 : 1));
        if (target.shieldUp && strong) { dmg = Math.round(dmg * 0.35); target.shieldUp = false; this.emit('shield-block', { uid: target.uid }); }
        this._damageCat(target, dmg, { strong, srcUid: e.uid, boss: true });
        // 第1形態: 配送箱の没収を試みる
        if (opts.steal && strong && this.deliveries.length) {
          const d = this.deliveries[0];
          d.arrive += 5;
          this.emit('delivery-stolen', { shopId: d.shopId });
        }
      }
    }

    /* ---------------- ダメージ/回復 ---------------- */
    _applyDamage(target, dmg, info) {
      if (target.dead) return;
      if (target.boss && target.boss.invulnT > 0) return;
      let dealt = dmg;
      let shielded = false;
      if (target.shieldReduce > 0 && target.shieldBroken <= 0) {
        let reduce = target.shieldReduce;
        if (this.relic === 'soot_claw' || this.hasShop('claw_forge')) reduce *= 0.5;
        dealt = Math.max(1, Math.round(dmg * (1 - reduce)));
        shielded = dealt < dmg;
        this.metrics.dmgShielded += dmg - dealt;
      }
      if (target.side === 'enemy' && target.boss && target.boss.phase === 2) {
        dealt = Math.max(1, Math.round(dealt * 0.6)); // 第3形態の盾行動
      }
      target.hp -= dealt;
      target.flash = 0.12;
      target.kb = info.strong ? 14 : 7;
      if (target.side === 'enemy') this.hitstop = info.strong ? BALANCE.combat.hitstopStrong : BALANCE.combat.hitstopWeak;
      this.emit('hit', {
        uid: target.uid, side: target.side, dmg: dealt, shielded,
        strong: !!info.strong, melee: !!info.melee, x: target.x, snipe: !!info.snipe
      });
      if (target.hp <= 0) {
        target.hp = 0;
        if (target.side === 'enemy') this._killEnemy(target);
        else this._faintCat(target);
      }
    }

    _damageCat(c, dmg, info) {
      if (c.dead || c.faintT > 0) return;
      c.hp -= dmg;
      c.flash = 0.12;
      c.kb = info.strong ? 12 : 6;
      this.metrics.catHpLost += dmg;
      const src = this.enemies.find(e => e.uid === info.srcUid);
      if (src && src.flying) this.metrics.dmgFlying += dmg;
      this.emit('cat-hit', { uid: c.uid, dmg, strong: !!info.strong });
      if (c.hp <= 0) { c.hp = 0; this._faintCat(c); }
    }

    _faintCat(c) {
      if (c.named) {
        c.faintT = BALANCE.cats.reviveTime;
        c.state = 'faint'; c.x = Math.max(BALANCE.world.entryX, c.x - 40);
        this.emit('cat-faint', { uid: c.uid, defId: c.defId });
      } else {
        c.dead = true;
        this.emit('helper-down', { uid: c.uid, defId: c.defId });
      }
    }

    _killEnemy(e) {
      e.dead = true;
      e.removeFlag = true;
      this.floorKillOrder.push(e.tag || e.defId);
      if (e.tag === 'ledger' && this.floor === 8 && this.floorKillOrder.length === 1) {
        this.kohaku.ledgerFirst = true;
        this.emit('ledger-first', {});
      }
      this.coins += e.reward;
      this.emit('ko', { uid: e.uid, defId: e.defId, x: e.x, reward: e.reward, boss: !!e.boss });
    }

    _heal(c, amount) {
      if (c.dead || c.faintT > 0) return;
      const before = c.hp;
      c.hp = Math.min(c.maxHp, c.hp + amount);
      this.metrics.healed += c.hp - before;
    }

    /* ---------------- 配送 (§10.1) ---------------- */
    _tickDeliveries(dt) {
      // 各店舗の出荷タイマー
      Object.keys(this.shops).forEach(f => {
        if (!(f in this.shopTimers)) this.shopTimers[f] = BALANCE.deliveries.interval;
        this.shopTimers[f] -= dt;
        if (this.shopTimers[f] <= 0) {
          let interval = BALANCE.deliveries.interval;
          if (this.relic === 'warm_box') interval *= 0.65;
          this.shopTimers[f] = interval;
          const shopId = this.shops[f];
          const from = parseInt(f, 10);
          const to = Math.max(from + 1, this.floor);
          const travel = 2 + Math.abs(to - from) * BALANCE.deliveries.travelPerFloor;
          this.deliveries.push({
            uid: UID++, shopId, fromFloor: from, toFloor: to,
            depart: this.time, arrive: this.time + travel, travel
          });
          this.emit('delivery-depart', { shopId, fromFloor: from, toFloor: to, travel });
        }
      });
      // 到着処理
      for (let i = this.deliveries.length - 1; i >= 0; i--) {
        const d = this.deliveries[i];
        if (this.time >= d.arrive) {
          this.deliveries.splice(i, 1);
          this._onDeliveryArrive(d);
        }
      }
    }

    _onDeliveryArrive(d) {
      const B = BALANCE.deliveries;
      let effect = 1;
      if (this.relic === 'warm_box') effect = 1.5;
      const shop = SHOPS[d.shopId];
      switch (d.shopId) {
        case 'fish_diner':
          this.cats.forEach(c => { if (!c.dead && c.faintT <= 0) this._heal(c, Math.round(c.maxHp * B.healRatio * effect)); });
          this.cats.forEach(c => { c.hasteFood = true; });
          setTimeoutSafe(this, 4, () => this.cats.forEach(c => { c.hasteFood = false; }));
          break;
        case 'claw_forge':
          this.cats.forEach(c => { c.forgeBuffT = B.forgeBuffTime * effect; });
          break;
        case 'clinic': {
          const hurt = this.cats.filter(c => !c.dead).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
          if (hurt) this._heal(hurt, Math.round(hurt.maxHp * B.clinicHeal * effect));
          this.cats.forEach(c => { if (c.named && c.faintT > 0) c.faintT = Math.min(c.faintT, 2); });
          break;
        }
        case 'guild':
          this.bellCd = 0;
          this.rallyT = Math.max(this.rallyT, 3 * effect);
          break;
      }
      // ルナ解放進捗: 3F制圧後の到着を数える
      if (this.maxFloorReached >= 3 && !this.unlocked.luna && this.lunaProgress < CATS.luna.unlock.need) {
        this.lunaProgress++;
        this.emit('luna-progress', { n: this.lunaProgress, need: CATS.luna.unlock.need });
        if (this.lunaProgress >= CATS.luna.unlock.need) {
          this.unlocked.luna = true;
          this.lunaSnipePending = true;
          this.emit('unlock-cat', { catId: 'luna', style: 'luna-pop' });
        }
      }
      // コハク条件2: 前線への配送到着5回
      if (this.maxFloorReached >= 3) {
        this.kohaku.deliveries++;
        if (this.kohaku.deliveries >= BALANCE.kohaku.deliveries) this.emit('kohaku-progress', { key: 'deliveries', n: this.kohaku.deliveries });
      }
      this.emit('delivery-arrive', { shopId: d.shopId, icon: shop.deliveryIcon, item: shop.deliveryItem, fromFloor: d.fromFloor });
    }

    /* ---------------- 制圧・登階 (§6.4) ---------------- */
    _onConquest() {
      const def = this.floorDef();
      this.mode = 'conquest';
      this.conquestT = 0;
      this.conquestPhase = 'hold';
      this.coins += def.coinReward;
      // 猫全員を勝利保持へ
      this.cats.forEach(c => { if (!c.dead && c.faintT <= 0) { c.state = 'hold'; c.stateT = 0; } });
      this.emit('floor-clear', { floor: this.floor, reward: def.coinReward });

      // 8F: コハク解放判定
      if (this.floor === 8 && !this.unlocked.kohaku) {
        this._updateKohakuShopCondition();
        if (this.kohaku.shopKinds && this.kohaku.deliveries >= BALANCE.kohaku.deliveries && this.kohaku.ledgerFirst) {
          this.unlocked.kohaku = true;
          this.kohaku.unlocked = true;
          this.emit('unlock-cat', { catId: 'kohaku', style: 'gate-burst' });
        }
      }
      // 5F: トト救出
      if (this.floor === 5 && !this.unlocked.toto) {
        this.unlocked.toto = true;
        this.emit('unlock-cat', { catId: 'toto', style: 'rescue' });
      }
    }

    _tickConquest(dt) {
      this.conquestT += dt;
      const T = BALANCE.floors.conquestTime;
      const W = BALANCE.world;
      // フェーズ: hold(0〜0.45) → toStairs(0.45〜1.15) → climb(1.15〜T)
      const phase = this.conquestT < T * 0.24 ? 'hold'
        : this.conquestT < T * 0.6 ? 'toStairs' : 'climb';
      if (phase !== this.conquestPhase) {
        this.conquestPhase = phase;
        this.emit('conquest-phase', { phase });
      }
      for (const c of this.cats) {
        if (c.dead || c.faintT > 0) continue;
        if (phase === 'toStairs') {
          c.state = 'toStairs';
          c.x = Math.min(W.stairsX, c.x + 200 * dt);
        } else if (phase === 'climb') {
          c.state = 'climb'; // 実際の上昇は app.js が stairsPath で描画
          c.stateT += dt;
        }
      }
      if (this.conquestT >= T) this._finishConquest();
    }

    _finishConquest() {
      const def = this.floorDef();
      // 制圧後の用途確定
      if (def.after && def.after.type === 'shop-choice' && !this.shops[this.floor]) {
        this.mode = 'choice';
        this._choiceFloor = this.floor;
        this.pendingChoice = { type: 'shop', floor: this.floor, candidates: def.after.candidates };
        this.emit('shop-choice', { floor: this.floor, candidates: def.after.candidates });
        return;
      }
      if (def.after && def.after.relic && !this.relic) {
        this.mode = 'choice';
        this.pendingChoice = { type: 'relic', floor: this.floor };
        this.emit('relic-choice', {});
        return;
      }
      this._advanceFloor();
    }

    _afterChoice() { this._advanceFloor(); }

    _advanceFloor() {
      if (this.floor >= 10) {
        this.mode = 'cleared';
        this.emit('district-clear', {});
        return;
      }
      this.enterFloor(this.floor + 1);
    }

    /* ---------------- 敗北 (§15) ---------------- */
    _onDefeat() {
      this.mode = 'defeat';
      if (this.floor >= 8) this.dawnNoticed = true;
      const m = this.metrics;
      const scores = [];
      scores.push(['frontline', 40]);
      if (m.dmgFlying > m.catHpLost * 0.4) scores.push(['antiair', m.dmgFlying]);
      if (m.dmgShielded > 60) scores.push(['shield', m.dmgShielded]);
      if (m.supportCasts >= 3) scores.push(['backline', m.supportCasts * 30]);
      if (m.catHpLost > m.healed * 2 + 100) scores.push(['recovery', m.catHpLost - m.healed]);
      if (m.helperUpT < m.totalT * 0.4) scores.push(['rotation', 50]);
      scores.sort((a, b) => b[1] - a[1]);
      this.defeatInfo = {
        floor: this.floor,
        causes: scores.slice(0, 2).map(s => DIAGNOSIS[s[0]])
      };
      this.emit('defeat', this.defeatInfo);
    }

    retryFloor() {
      this.defeatInfo = null;
      this.enterFloor(this.floor);
      // 再戦時は名前付き猫を立て直す
      this.cats.forEach(c => { if (c.named) { c.hp = c.maxHp; c.faintT = 0; c.dead = false; } });
      this.emit('retry', { floor: this.floor });
    }

    // コハク条件用: 8Fへ再挑戦 (達成済み項目は保持)
    replayFloor(n) {
      this.enterFloor(n);
      this.cats.forEach(c => { if (c.named) { c.hp = c.maxHp; c.faintT = 0; c.dead = false; } });
      this.emit('retry', { floor: n });
    }

    /* ---------------- 外部参照用スナップショット ---------------- */
    kohakuConditions() {
      return [
        { key: 'shops', label: `ショップを${BALANCE.kohaku.shopKinds}種類以上配置`, done: this.kohaku.shopKinds, progress: `${this.shopKinds()}/${BALANCE.kohaku.shopKinds}` },
        { key: 'deliveries', label: `補給箱を${BALANCE.kohaku.deliveries}回到着`, done: this.kohaku.deliveries >= BALANCE.kohaku.deliveries, progress: `${Math.min(this.kohaku.deliveries, BALANCE.kohaku.deliveries)}/${BALANCE.kohaku.deliveries}` },
        { key: 'ledger', label: '8Fで帳簿係を最初に倒す', done: this.kohaku.ledgerFirst, progress: this.kohaku.ledgerFirst ? '達成' : '未達' }
      ];
    }
  }

  // setTimeout をコアに持ち込まないための簡易遅延 (シム時間で実行)
  function setTimeoutSafe(game, sec, fn) {
    const item = { at: game.time + sec, fn };
    if (!game._timers) {
      game._timers = [];
      const origUpdate = game.update.bind(game);
      game.update = function (dt) {
        origUpdate(dt);
        for (let i = game._timers.length - 1; i >= 0; i--) {
          if (game.time >= game._timers[i].at) { const t = game._timers.splice(i, 1)[0]; t.fn(); }
        }
      };
    }
    game._timers.push(item);
  }

  const EXPORT = { Game };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORT;
  global.GAME_CORE = EXPORT;
})(typeof window !== 'undefined' ? window : globalThis);
