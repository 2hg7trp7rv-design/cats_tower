/* =========================================================================
 * Cat's Tower — 放置クリッカー版 (IDLE_DESIGN.md 準拠)
 * game-core.js : 秒ベースtickのシミュレーション (DOM/描画/音に依存しない)
 *
 *   - Node から require してバランス検証できる (module.exports)。
 *   - オート出撃・タップ招集・HP壁の敵・階進行・3店舗購入・建店・夜明け・
 *     オフライン収益・セーブ/ロード用シリアライズをすべてここで扱う。
 *   - 画面へ出す出来事は this.events に {type, ...} で積み、app.js が拾う。
 * ========================================================================= */
(function (global) {
  'use strict';

  const DATA = (typeof module !== 'undefined' && module.exports)
    ? require('./game-data.js')
    : global.GAME_DATA;

  const {
    JOBS, JOB_ORDER, weaponAt, ITEMS, SHOP_ORDER, dinerIncome, sameShopFactor,
    TREASURES, isBossFloor, guardianHp, addHp, floorCoins, guardianSprite, addSprite,
    BALANCE
  } = DATA;

  let UID = 1;

  /* 決定論的RNG (シードをセーブに含め、Node検証を再現可能に) */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Game {
    constructor() {
      this.events = [];
      this.sparkles = 0;
      this.treasures = {};              // 宝物庫の購入済みフラグ (永続)
      this._rngSeed = (Date.now() % 2147483646) + 1;
      this._rand = mulberry32(this._rngSeed);
      this.lastSave = Date.now();
      this.resetRun();
    }

    emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }
    drainEvents() { const e = this.events; this.events = []; return e; }

    /* ================= 周回リセット (夜明けでも使用) ================= */
    resetRun() {
      const startFloorBonus = this.treasures.shortcut ? 5 : 0; // 宝物庫: 開始階+5
      this.floor = 1 + startFloorBonus;
      this.maxFloor = this.floor - 1;   // 制圧済みの最大階
      const baseStartCoins = 25;
      this.coins = baseStartCoins * (this.treasures.seed_money ? 3 : 1); // 宝物庫: 初期コイン×3
      this.jobs = { warrior: { owned: 1, lv: 1 } }; // 最初の仲間 (操作なしで進行するため)
      this.weapons = {};                // id -> true (全所持が乗算)
      this.weaponCount = 0;
      this.items = {};                  // id -> 個数
      this.shopsBuilt = {};             // 階 -> shopId
      this.pendingShopChoices = [];     // [{floor, options:[shopId×3]}]
      this.bossKills = 0;               // この周回のボス撃破数
      this.time = 0;
      this.fieldCats = [];              // [{uid, jobId, x, state, atkT, faint}]
      this.autoTimer = 1.0;             // 最初のオート出撃まで
      this.tapCd = 0;
      this.incomeCarry = 0;             // 収益の端数
      this.spawnFloor(this.floor);
    }

    /* ================= 階の生成 (§4.4) ================= */
    spawnFloor(n) {
      const gHp = guardianHp(n);
      const boss = isBossFloor(n);
      const addCount = Math.floor(this._rand() * 4); // 0〜3体
      this.enemies = [];
      for (let i = 0; i < addCount; i++) {
        const hp = addHp(n);
        this.enemies.push({
          uid: UID++, kind: 'add', sprite: addSprite(n, i),
          hp: hp, maxHp: hp, x: 258 - i * 26, boss: false
        });
      }
      this.enemies.push({
        uid: UID++, kind: 'guardian', sprite: guardianSprite(n),
        hp: gHp, maxHp: gHp, x: 312, boss: boss, atkT: BALANCE.guardianAttackInterval
      });
      this.emit('floor-enter', { floor: n, boss: boss });
    }

    get guardian() { return this.enemies.find(e => e.kind === 'guardian') || null; }
    nearestEnemy() {
      let best = null;
      for (const e of this.enemies) if (!best || e.x < best.x) best = e;
      return best;
    }

    /* ================= 派生ステータス ================= */
    totalJobLv() {
      let s = 0;
      for (const id in this.jobs) s += this.jobs[id].lv;
      return s;
    }
    isJobUnlocked(id) { return this.totalJobLv() >= JOBS[id].unlockTotalLv; }
    jobHireCost(id) { return Math.ceil(JOBS[id].baseCost * Math.pow(1.16, (this.jobs[id] || { owned: 0 }).owned)); }
    jobLvCost(id) {
      const lv = (this.jobs[id] || { lv: 0 }).lv;
      return Math.ceil(JOBS[id].baseCost * 0.8 * Math.pow(1.22, lv));
    }
    weaponMult() {
      let m = 1;
      for (let k = 1; k <= this.weaponCount; k++) m *= weaponAt(k).mult;
      return m;
    }
    // 同種店ボーナス込みの効果係数合計 (建てた階の昇順で 1, 1.5, 2, 2...)
    shopFactorSum(shopId) {
      const floors = Object.keys(this.shopsBuilt).map(Number).filter(f => this.shopsBuilt[f] === shopId).sort((a, b) => a - b);
      let s = 0;
      floors.forEach((f, i) => { s += sameShopFactor(i + 1); });
      return s;
    }
    armoryMult() { return 1 + 0.15 * this.shopFactorSum('armory'); }
    treasureAtkMult() { return this.treasures.war_drum ? 1.5 : 1; }
    atkMult() { return this.weaponMult() * this.armoryMult() * this.treasureAtkMult(); }
    speedMult() { return 1 + 0.08 * (this.items.energy_drink || 0); }
    moveMult() { return 1 + 0.12 * (this.items.boots || 0); }
    coinMult() { return 1 + 0.25 * (this.items.lucky_coin || 0); }
    tapCount() { return 1 + (this.items.bell_charm || 0); }
    autoSlots() { return 1 + (this.treasures.extra_slot ? 1 : 0); }
    autoInterval() {
      const floors = Object.keys(this.shopsBuilt).map(Number).filter(f => this.shopsBuilt[f] === 'guild').sort((a, b) => a - b);
      let iv = BALANCE.autoDeployBase;
      floors.forEach((f, i) => { iv *= (1 - 0.12 * sameShopFactor(i + 1)); });
      return iv;
    }
    get incomePerSec() {
      let s = 0;
      const diners = Object.keys(this.shopsBuilt).map(Number).filter(f => this.shopsBuilt[f] === 'diner').sort((a, b) => a - b);
      diners.forEach((f, i) => { s += dinerIncome(f) * sameShopFactor(i + 1); });
      return s * (this.treasures.ledger ? 1.5 : 1);
    }
    catDamage(jobId) {
      const j = this.jobs[jobId];
      if (!j) return 0;
      return JOBS[jobId].baseAtk * (1 + 0.25 * (j.lv - 1)) * this.atkMult();
    }
    catInterval(jobId) { return JOBS[jobId].interval / this.speedMult(); }

    /* ---------- HUD用ゲッタ (window.__game テスト契約) ---------- */
    get dps() {
      let s = 0;
      for (const c of this.fieldCats) {
        if (c.state === 'faint') continue;
        s += this.catDamage(c.jobId) / this.catInterval(c.jobId);
      }
      return s;
    }
    get enemyHp() { const g = this.guardian; return g ? g.hp : 0; }
    get enemyMaxHp() { const g = this.guardian; return g ? g.maxHp : 1; }
    get catsOnScreen() { return this.fieldCats.filter(c => c.state !== 'faint').length; }
    get prestigeAvailable() { return this.maxFloor >= BALANCE.prestigeUnlockFloor; }

    /* ================= 招集 ================= */
    _spawnCat() {
      // 雇用済みロースターから所持数で重み付け抽出
      const pool = [];
      for (const id of JOB_ORDER) {
        const j = this.jobs[id];
        if (j && j.owned > 0) for (let i = 0; i < j.owned; i++) pool.push(id);
      }
      if (!pool.length) return null;
      const jobId = pool[Math.floor(this._rand() * pool.length)];
      if (this.catsOnScreen >= BALANCE.maxFieldCats) return null;
      const cat = { uid: UID++, jobId: jobId, x: 30, state: 'walk', atkT: 0, faint: 0 };
      this.fieldCats.push(cat);
      return cat;
    }
    // タップ招集: 0.12秒間隔上限 (§5)。招集は無料。
    tap() {
      if (this.tapCd > 0) return 0;
      this.tapCd = BALANCE.tapInterval;
      let n = 0;
      const count = this.tapCount();
      for (let i = 0; i < count; i++) if (this._spawnCat()) n++;
      if (n > 0) this.emit('summon', { count: n });
      return n;
    }

    /* ================= メインtick (秒) ================= */
    update(dt) {
      this.time += dt;
      if (this.tapCd > 0) this.tapCd -= dt;

      // オート出撃: 3秒ごと (宝物庫で+1枠 / 派遣支所で間隔短縮)
      this.autoTimer -= dt;
      const iv = this.autoInterval();
      while (this.autoTimer <= 0) {
        this.autoTimer += iv;
        let n = 0;
        for (let i = 0; i < this.autoSlots(); i++) if (this._spawnCat()) n++;
        if (n > 0) this.emit('auto-spawn', { count: n });
      }

      // 収益 (魚食堂): 1秒ごとにまとめてイベント
      const inc = this.incomePerSec;
      if (inc > 0) {
        this.coins += inc * dt;
        this.incomeCarry += dt;
        if (this.incomeCarry >= 1) { this.incomeCarry -= 1; this.emit('income', { perSec: inc }); }
      }

      // 猫の移動・攻撃
      const moveSpeed = BALANCE.fieldCatSpeed * this.moveMult();
      const target = this.nearestEnemy();
      for (const c of this.fieldCats) {
        if (c.state === 'faint') {
          c.x -= moveSpeed * 1.6 * dt; // 気絶して入口へ戻る (損失なし)
          continue;
        }
        if (!target) { c.state = 'walk'; continue; }
        const stopX = target.x - 30;
        if (c.x < stopX) {
          c.state = 'walk';
          c.x = Math.min(stopX, c.x + moveSpeed * dt);
        } else {
          c.state = 'fight';
          c.atkT += dt;
          const catIv = this.catInterval(c.jobId);
          while (c.atkT >= catIv) {
            c.atkT -= catIv;
            const tgt = this.nearestEnemy();
            if (!tgt) break;
            const dmg = this.catDamage(c.jobId);
            tgt.hp -= dmg;
            this.emit('hit', { uid: c.uid, jobId: c.jobId, dmg: dmg, x: tgt.x, boss: tgt.boss });
            if (tgt.hp <= 0) this._onEnemyDown(tgt);
            if (!this.enemies.length) break;
          }
        }
      }
      // 退場した気絶猫を除去
      this.fieldCats = this.fieldCats.filter(c => c.state !== 'faint' || c.x > 8);

      // 守護者の反撃: 間合いに入った猫を気絶させるだけ (損失なし, §4.4)
      const g = this.guardian;
      if (g) {
        const fighters = this.fieldCats.filter(c => c.state !== 'faint' && c.x > g.x - 90);
        if (fighters.length) {
          g.atkT -= dt;
          if (g.atkT <= 0) {
            g.atkT += BALANCE.guardianAttackInterval;
            const c = fighters[Math.floor(this._rand() * fighters.length)];
            c.state = 'faint';
            this.emit('cat-faint', { uid: c.uid, jobId: c.jobId });
          }
        }
      }
    }

    _onEnemyDown(e) {
      this.enemies = this.enemies.filter(x => x !== e);
      if (e.kind === 'add') {
        this.emit('add-down', { x: e.x });
        return;
      }
      // 守護者撃破 = 階制圧 (§4.4)
      const n = this.floor;
      const boss = isBossFloor(n);
      const reward = floorCoins(n) * this.coinMult();
      this.coins += reward;
      if (boss) this.bossKills++;
      this.maxFloor = Math.max(this.maxFloor, n);
      // 残ったザコも一掃
      for (const a of this.enemies.slice()) this.emit('add-down', { x: a.x });
      this.enemies = [];
      // 建店3択 (§4.5)
      const opts = SHOP_ORDER.slice();
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(this._rand() * (i + 1));
        const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
      }
      this.pendingShopChoices.push({ floor: n, options: opts.slice(0, 3) });
      this.emit('floor-clear', { floor: n, boss: boss, coin: reward });
      this.floor = n + 1;
      this.spawnFloor(this.floor);
    }

    /* ================= 購入系 ================= */
    hireJob(id) {
      if (!JOBS[id] || !this.isJobUnlocked(id)) return false;
      const cost = this.jobHireCost(id);
      if (this.coins < cost) return false;
      this.coins -= cost;
      if (!this.jobs[id]) this.jobs[id] = { owned: 0, lv: 1 };
      this.jobs[id].owned++;
      this.emit('hire', { jobId: id });
      return true;
    }
    levelUpJob(id) {
      if (!this.jobs[id]) return false;
      const cost = this.jobLvCost(id);
      if (this.coins < cost) return false;
      this.coins -= cost;
      this.jobs[id].lv++;
      this.emit('job-lvup', { jobId: id, lv: this.jobs[id].lv });
      return true;
    }
    nextWeapon() { return weaponAt(this.weaponCount + 1); }
    buyWeapon() {
      const w = this.nextWeapon();
      if (!w || this.coins < w.cost) return false;
      this.coins -= w.cost;
      this.weapons[w.id] = true;
      this.weaponCount++;
      this.emit('weapon-buy', { id: w.id });
      return true;
    }
    itemCost(id) { return Math.ceil(ITEMS[id].baseCost * Math.pow(ITEMS[id].costMult, this.items[id] || 0)); }
    buyItem(id) {
      if (!ITEMS[id]) return false;
      const cost = this.itemCost(id);
      if (this.coins < cost) return false;
      this.coins -= cost;
      this.items[id] = (this.items[id] || 0) + 1;
      this.emit('item-buy', { id: id });
      return true;
    }

    /* ================= 建店 (制圧階, 再配置自由) ================= */
    buildShop(floorN, shopId) {
      if (floorN > this.maxFloor || !SHOP_ORDER.includes(shopId)) return false;
      this.shopsBuilt[floorN] = shopId;
      this.pendingShopChoices = this.pendingShopChoices.filter(c => c.floor !== floorN);
      this.emit('shop-built', { floor: floorN, shopId: shopId });
      return true;
    }
    skipShopChoice(floorN) {
      this.pendingShopChoices = this.pendingShopChoices.filter(c => c.floor !== floorN);
    }

    /* ================= 夜明け PRESTIGE (§4.6) ================= */
    prestigeGain() {
      if (!this.prestigeAvailable) return 0;
      return Math.floor((this.maxFloor - 9) * 1.5 + this.bossKills);
    }
    prestige() {
      if (!this.prestigeAvailable) return 0;
      const gain = this.prestigeGain();
      this.sparkles += gain;
      this.resetRun();
      this.emit('dawn', { gain: gain });
      return gain;
    }
    buyTreasure(id) {
      const t = TREASURES[id];
      if (!t || this.treasures[id] || this.sparkles < t.cost) return false;
      this.sparkles -= t.cost;
      this.treasures[id] = true;
      this.emit('treasure-buy', { id: id });
      return true;
    }

    /* ================= オフライン収益 (§4.7) ================= */
    offlineEfficiency() {
      return Math.min(1, BALANCE.offlineEfficiency + 0.15 * this.shopFactorSum('bank'));
    }
    offlineGain(elapsedMs) {
      const sec = Math.min(BALANCE.offlineMaxHours * 3600, Math.max(0, elapsedMs / 1000));
      return sec * this.incomePerSec * this.offlineEfficiency();
    }

    /* ================= デバッグ (検証用。本番UIには出さない) ================= */
    debugAddCoins(n) {
      this.coins += n;
      return this.coins;
    }

    /* ================= セーブ/ロード ================= */
    serialize() {
      this.lastSave = Date.now();
      return {
        v: 1,
        floor: this.floor,
        maxFloor: this.maxFloor,
        coins: this.coins,
        sparkles: this.sparkles,
        lastSave: this.lastSave,
        jobs: this.jobs,
        weapons: this.weapons,
        weaponCount: this.weaponCount,
        items: this.items,
        shopsBuilt: this.shopsBuilt,
        pendingShopChoices: this.pendingShopChoices,
        bossKills: this.bossKills,
        treasures: this.treasures,
        rngSeed: this._rngSeed,
        time: this.time
      };
    }
    deserialize(d) {
      if (!d || typeof d !== 'object') return false;
      this.sparkles = d.sparkles || 0;
      this.treasures = d.treasures || {};
      this._rngSeed = d.rngSeed || ((Date.now() % 2147483646) + 1);
      this._rand = mulberry32(this._rngSeed);
      this.lastSave = d.lastSave || Date.now();
      this.resetRun();
      // 周回内の状態を復元
      this.floor = Math.max(1, d.floor || 1);
      this.maxFloor = d.maxFloor || 0;
      this.coins = d.coins || 0;
      this.jobs = d.jobs && Object.keys(d.jobs).length ? d.jobs : { warrior: { owned: 1, lv: 1 } };
      this.weapons = d.weapons || {};
      this.weaponCount = d.weaponCount || 0;
      this.items = d.items || {};
      this.shopsBuilt = d.shopsBuilt || {};
      this.pendingShopChoices = d.pendingShopChoices || [];
      this.bossKills = d.bossKills || 0;
      this.time = d.time || 0;
      this.spawnFloor(this.floor);
      return true;
    }
  }

  const EXPORT = { Game: Game, BALANCE: BALANCE };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORT;
  global.GAME_CORE = EXPORT;
})(typeof window !== 'undefined' ? window : globalThis);
