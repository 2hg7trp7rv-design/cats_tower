/* =========================================================================
 * Cat's Tower — 商人サーガ忠実版 (CLONE_DESIGN.md 準拠)
 * game-core.js : 秒ベースtickのシミュレーション (DOM/描画/音に依存しない)
 *
 *   - Node から require してバランス検証できる (module.exports)。
 *   - オート出撃・タップ招集・ザコ連続出現(撃破数制圧)・ボス階・属性相性・
 *     人材派遣屋/武器屋/道具屋・建店2種・転生・オフライン収益・
 *     セーブ/ロード用シリアライズをすべてここで扱う。
 *   - 画面へ出す出来事は this.events に {type, ...} で積み、app.js が拾う。
 * ========================================================================= */
(function (global) {
  'use strict';

  const DATA = (typeof module !== 'undefined' && module.exports)
    ? require('./game-data.js')
    : global.GAME_DATA;

  const {
    JOBS, JOB_ORDER, weaponAt, ITEMS, SHOP_ORDER, shopIncome, LEGACY_SHOP_MAP,
    TREASURES, ELEMENTS, floorElement,
    isBossFloor, killNeed, guardianHp, addHp, floorCoins, addCoins,
    guardianSprite, addSprite,
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
      this.sparkles = 0;                // 💎ルビー (転生で得る永続通貨。キー名は互換のため維持)
      this.treasures = {};              // 伝説の道具屋の購入済みフラグ (永続)
      this._rngSeed = (Date.now() % 2147483646) + 1;
      this._rand = mulberry32(this._rngSeed);
      this.lastSave = Date.now();
      this.resetRun();
    }

    emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }
    drainEvents() { const e = this.events; this.events = []; return e; }

    /* ================= 周回リセット (転生でも使用) ================= */
    resetRun() {
      const startFloorBonus = this.treasures.shortcut ? 5 : 0; // 伝説の道具屋: 開始階+5
      this.floor = 1 + startFloorBonus;
      this.maxFloor = this.floor - 1;   // 制圧済みの最大階
      const baseStartCoins = 25;
      this.coins = baseStartCoins * (this.treasures.seed_money ? 3 : 1); // 伝説の道具屋: 初期コイン×3
      this.jobs = { warrior: { owned: 1, lv: 1 } }; // 最初の仲間 (操作なしで進行するため)
      this.weapons = {};                // id -> true (全所持が乗算)
      this.weaponCount = 0;
      this.items = {};                  // id -> 個数
      this.shopsBuilt = {};             // 階 -> shopId ('weapon' | 'item')
      this.pendingShopChoices = [];     // [{floor, options:[shopId×2]}]
      this.bossKills = 0;               // この周回のボス撃破数
      this.time = 0;
      this.fieldCats = [];              // [{uid, jobId, x, state, atkT, faint}]
      this.autoTimer = 1.0;             // 最初のオート出撃まで
      this.tapCd = 0;
      this.incomeCarry = 0;             // 収益の端数
      this._markDirty();
      this.spawnFloor(this.floor);
    }

    /* ================= 階の生成 (§6: ザコ連続出現 / ボス階) ================= */
    spawnFloor(n) {
      this.enemies = [];
      this.kills = 0;                       // この階の撃破数
      this.killNeed = isBossFloor(n) ? 1 : killNeed(n); // 制圧に必要な撃破数
      this.spawnedAdds = 0;
      if (isBossFloor(n)) {
        const hp = guardianHp(n);
        this.enemies.push({
          uid: UID++, kind: 'guardian', sprite: guardianSprite(n),
          hp: hp, maxHp: hp, x: 312, boss: true,
          attr: floorElement(n), atkT: BALANCE.bossAttackInterval
        });
      } else {
        this._refillAdds(); // ザコを同時1〜3体まで出す
      }
      this.emit('floor-enter', { floor: n, boss: isBossFloor(n), attr: floorElement(n) });
    }

    // ザコを同時上限(1〜3体)まで補充。規定数を超えては出さない。
    _refillAdds() {
      if (isBossFloor(this.floor)) return;
      const cap = 1 + Math.floor(this._rand() * BALANCE.maxFieldEnemies); // 1〜3
      while (this.enemies.length < cap && this.spawnedAdds < this.killNeed) {
        const i = this.spawnedAdds;
        const hp = addHp(this.floor);
        this.enemies.push({
          uid: UID++, kind: 'add', sprite: addSprite(this.floor, i),
          hp: hp, maxHp: hp, x: 258 - (i % 3) * 26, boss: false,
          attr: floorElement(this.floor)
        });
        this.spawnedAdds++;
      }
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
    // 建設数 = 店ランク (§5)。派生値はキャッシュし、購入/建店/転生で無効化する。
    get _d() {
      if (!this._derived) this._recomputeDerived();
      return this._derived;
    }
    _markDirty() { this._derived = null; }
    _recomputeDerived() {
      let wRank = 0, iRank = 0, income = 0;
      for (const f of Object.keys(this.shopsBuilt)) {
        const id = this.shopsBuilt[f];
        if (id === 'weapon') { wRank++; income += shopIncome(Number(f)); }
        else if (id === 'item') { iRank++; income += shopIncome(Number(f)); }
        // 旧店種は無視
      }
      let weaponBase = 1;
      const ownedAttrs = {};
      for (let k = 1; k <= this.weaponCount; k++) {
        const w = weaponAt(k);
        weaponBase *= w.mult;
        if (w.attr && w.attr !== 'none') ownedAttrs[w.attr] = true;
      }
      this._derived = { wRank, iRank, income, weaponBase, ownedAttrs };
    }
    shopRank(shopId) { return shopId === 'weapon' ? this._d.wRank : shopId === 'item' ? this._d.iRank : 0; }
    weaponRank() { return this._d.wRank; }
    itemRank() { return this._d.iRank; }
    // 同種ボーナス: 2件目以降 +10%/件 (§5)
    weaponShopBonus() { return 1 + 0.1 * Math.max(0, this._d.wRank - 1); }
    itemShopBonus() { return 1 + 0.1 * Math.max(0, this._d.iRank - 1); }
    weaponMult() { return this._d.weaponBase * this.weaponShopBonus(); }
    // 属性相性 (§3): 弱点属性の武器を1本でも所持で×1.5 / 耐性のみなら×0.5
    elementMult(enemy) {
      if (!enemy || !enemy.attr || enemy.attr === 'none') return 1;
      const weak = ELEMENTS[enemy.attr].weak;
      if (this._d.ownedAttrs[weak]) return 1.5;
      if (this._d.ownedAttrs[enemy.attr]) return 0.5;
      return 1;
    }
    treasureAtkMult() { return this.treasures.war_drum ? 1.5 : 1; }
    atkMult() { return this.weaponMult() * this.treasureAtkMult(); }
    speedMult() { return (1 + 0.08 * (this.items.energy_drink || 0)) * this.itemShopBonus(); }
    moveMult() { return (1 + 0.12 * (this.items.boots || 0)) * this.itemShopBonus(); }
    coinMult() { return (1 + 0.25 * (this.items.lucky_coin || 0)) * this.itemShopBonus(); }
    tapCount() { return 1 + Math.floor((this.items.bell_charm || 0) * this.itemShopBonus()); }
    autoSlots() { return 1 + (this.treasures.extra_slot ? 1 : 0); }
    // 全ジョブの所持数合計 (所持数 = 同時に戦場に出る仲間の数)
    totalOwned() { let s = 0; for (const id in this.jobs) s += this.jobs[id].owned; return s; }
    // 実機FB: 所持数に意味を持たせる — 総所持数が多いほどオート出撃の連射が速くなる
    // (Merchant Saga の「仲間数=攻撃回数」相当)。interval = base * 25/(25+totalOwned)、下限 0.25秒。
    autoInterval() {
      return Math.max(0.25, BALANCE.autoDeployBase * (25 / (25 + this.totalOwned())));
    }
    get incomePerSec() {
      return this._d.income * (this.treasures.ledger ? 1.5 : 1);
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
    // 上限到達時のリサイクル対象を1体選ぶ:
    //   1) state==='walk' の中で x 最大 (出口から最も遠い=前線直近) のもの
    //   2) 無ければ state==='fight' の最古 (fieldCats は push 順=古い順)
    //   3) それも無ければ最古の faint
    _recycleVictim() {
      let victim = null;
      for (const c of this.fieldCats) {
        if (c.state === 'walk' && (!victim || c.x > victim.x)) victim = c;
      }
      if (victim) return victim;
      const fight = this.fieldCats.find(c => c.state === 'fight');
      if (fight) return fight;
      return this.fieldCats[0] || null; // 最古 (faint しか残っていないケース)
    }
    // recycle=true (タップ経由) のとき上限到達なら最も出口に近い/最古の猫を1体リサイクルして必ずスポーン。
    // recycle=false (オート出撃) は従来どおり上限を尊重して null を返す。
    _spawnCat(recycle) {
      // 雇用済みロースターから所持数で重み付け抽出
      const pool = [];
      for (const id of JOB_ORDER) {
        const j = this.jobs[id];
        if (j && j.owned > 0) for (let i = 0; i < j.owned; i++) pool.push(id);
      }
      if (!pool.length) return null;
      const jobId = pool[Math.floor(this._rand() * pool.length)];
      if (this.catsOnScreen >= BALANCE.maxFieldCats) {
        if (!recycle) return null;
        const victim = this._recycleVictim();
        if (!victim) return null;
        this.fieldCats = this.fieldCats.filter(c => c !== victim);
        this.emit('cat-recycle', { uid: victim.uid, jobId: victim.jobId });
      }
      const cat = { uid: UID++, jobId: jobId, x: 30, state: 'walk', atkT: 0, faint: 0 };
      this.fieldCats.push(cat);
      return cat;
    }
    // タップ招集: 0.12秒間隔上限。招集は無料。
    // 実機FB: 敵HPリジェネ膠着で猫が帯に溜まるとタップが無反応になっていた。
    // タップ経由は上限到達時にリサイクルして必ずスポーンし、常に視覚フィードバックを返す。
    tap() {
      if (this.tapCd > 0) return 0;
      this.tapCd = BALANCE.tapInterval;
      let n = 0;
      const count = this.tapCount();
      for (let i = 0; i < count; i++) if (this._spawnCat(true)) n++;
      if (n > 0) this.emit('summon', { count: n });
      return n;
    }

    /* ================= メインtick (秒) ================= */
    update(dt) {
      this.time += dt;
      if (this.tapCd > 0) this.tapCd -= dt;

      // オート出撃: 3秒ごと (伝説の道具屋で+1枠)
      this.autoTimer -= dt;
      const iv = this.autoInterval();
      while (this.autoTimer <= 0) {
        this.autoTimer += iv;
        let n = 0;
        for (let i = 0; i < this.autoSlots(); i++) if (this._spawnCat()) n++;
        if (n > 0) this.emit('auto-spawn', { count: n });
      }

      // 店の売上: 1秒ごとにまとめてイベント
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
            const dmg = this.catDamage(c.jobId) * this.elementMult(tgt);
            tgt.hp -= dmg;
            this.emit('hit', { uid: c.uid, jobId: c.jobId, dmg: dmg, x: tgt.x, boss: tgt.boss });
            if (tgt.hp <= 0) this._onEnemyDown(tgt);
            if (!this.enemies.length) break;
          }
        }
      }
      // 退場した気絶猫を除去
      this.fieldCats = this.fieldCats.filter(c => c.state !== 'faint' || c.x > 8);

      // ボスの反撃: 間合いに入った猫を気絶させるだけ (損失なし)
      const g = this.guardian;
      if (g) {
        const fighters = this.fieldCats.filter(c => c.state !== 'faint' && c.x > g.x - 90);
        if (fighters.length) {
          g.atkT -= dt;
          if (g.atkT <= 0) {
            g.atkT += BALANCE.bossAttackInterval;
            const c = fighters[Math.floor(this._rand() * fighters.length)];
            c.state = 'faint';
            this.emit('cat-faint', { uid: c.uid, jobId: c.jobId });
          }
        }
      }
    }

    _onEnemyDown(e) {
      this.enemies = this.enemies.filter(x => x !== e);
      this.kills++;
      if (e.kind === 'add') {
        const reward = addCoins(this.floor) * this.coinMult();
        this.coins += reward;
        this.emit('add-down', { x: e.x, kills: this.kills, killNeed: this.killNeed, coin: reward });
        if (this.kills >= this.killNeed) { this._clearFloor(); return; }
        this._refillAdds();
        return;
      }
      // ボス撃破 = 制圧 (§6)
      this.bossKills++;
      this._clearFloor();
    }

    // 制圧: 報酬・建店2択の提示・次階へ (§5/§6)
    _clearFloor() {
      const n = this.floor;
      const boss = isBossFloor(n);
      // 報酬: ボス階は総量を撃破時に、通常階はザコ撃破で按分済みなので制圧ボーナスのみ
      const reward = boss ? floorCoins(n) * this.coinMult() : 0;
      this.coins += reward;
      // 表示用の獲得総額 (通常階はザコ撃破で按分済み)
      const displayCoin = boss ? reward : floorCoins(n) * this.coinMult();
      this.maxFloor = Math.max(this.maxFloor, n);
      // 残った敵を一掃
      for (const a of this.enemies.slice()) this.emit('add-down', { x: a.x, kills: this.kills, killNeed: this.killNeed });
      this.enemies = [];
      // 建店2択 (§5: 武器屋・道具屋)
      const opts = SHOP_ORDER.slice();
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(this._rand() * (i + 1));
        const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
      }
      this.pendingShopChoices.push({ floor: n, options: opts });
      this.emit('floor-clear', { floor: n, boss: boss, coin: displayCoin });
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
    // 武器は武器屋を建設済みでのみ購入可 (§3)。解放は総購入数 or 武器屋ランク。
    nextWeapon() { return weaponAt(this.weaponCount + 1); }
    isWeaponUnlocked(w) {
      return this.weaponCount >= w.unlockCount || this.weaponRank() >= (w.unlockRank || Infinity);
    }
    buyWeapon() {
      if (this.weaponRank() < 1) return false; // 武器屋未建設
      const w = this.nextWeapon();
      if (!w || !this.isWeaponUnlocked(w)) return false;
      if (this.coins < w.cost) return false;
      this.coins -= w.cost;
      this.weapons[w.id] = true;
      this.weaponCount++;
      this._markDirty();
      this.emit('weapon-buy', { id: w.id });
      return true;
    }
    itemCost(id) { return Math.ceil(ITEMS[id].baseCost * Math.pow(ITEMS[id].costMult, this.items[id] || 0)); }
    isItemUnlocked(id) { return this.itemRank() >= (ITEMS[id].unlockRank || 1); }
    // 道具は道具屋を建設済みでのみ購入可 (§4)。品ぞろえは道具屋ランクで解放。
    buyItem(id) {
      if (!ITEMS[id]) return false;
      if (this.itemRank() < 1 || !this.isItemUnlocked(id)) return false;
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
      this._markDirty();
      this.pendingShopChoices = this.pendingShopChoices.filter(c => c.floor !== floorN);
      this.emit('shop-built', { floor: floorN, shopId: shopId });
      return true;
    }
    skipShopChoice(floorN) {
      this.pendingShopChoices = this.pendingShopChoices.filter(c => c.floor !== floorN);
    }

    /* ================= 転生 PRESTIGE (§7) ================= */
    prestigeGain() {
      if (!this.prestigeAvailable) return 0;
      return Math.floor((this.maxFloor - 9) * 1.5 + this.bossKills);
    }
    prestige() {
      if (!this.prestigeAvailable) return 0;
      const gain = this.prestigeGain();
      this.sparkles += gain; // 💎ルビー
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

    /* ================= オフライン収益 (§9) ================= */
    offlineEfficiency() { return BALANCE.offlineEfficiency; }
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
      // 旧版セーブの店種は読み替え (武器蔵→武器屋、他→道具屋)
      this.shopsBuilt = {};
      for (const f of Object.keys(d.shopsBuilt || {})) {
        const id = d.shopsBuilt[f];
        this.shopsBuilt[f] = SHOP_ORDER.includes(id) ? id : (LEGACY_SHOP_MAP[id] || 'item');
      }
      this._markDirty();
      // 旧版セーブの建店選択肢は2種フォーマットへ読み替え
      this.pendingShopChoices = (d.pendingShopChoices || []).map(c => ({
        floor: c.floor,
        options: (c.options || []).map(o => (SHOP_ORDER.includes(o) ? o : (LEGACY_SHOP_MAP[o] || 'item')))
      })).filter(c => c.options.length);
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
