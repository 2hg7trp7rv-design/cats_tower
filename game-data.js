/* =========================================================================
 * Cat's Tower — 放置クリッカー版 (IDLE_DESIGN.md 準拠)
 * game-data.js : データ定義正本 (IDLE_DESIGN.md §4)
 *
 * 職業5種 / 武器6種+自動生成 / 道具4種 / 建店4種 / 宝物庫 / 階・敵の数値式。
 * スプライト契約: visibleBounds は [x, y, w, h] 形式 (anchors.json と同一)。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * §4.1 職業 JOBS (ねこ派遣所)
   * 雇用コスト: base × 1.16^owned / Lvアップコスト: base × 0.8 × 1.22^lv
   * レベルで攻撃力 +25%/Lv (Lv1 = base)
   * ------------------------------------------------------------------ */
  const JOBS = {
    warrior:  { id: 'warrior',  name: 'むぎわら戦士', role: 'バランス',   unlockTotalLv: 0,   baseCost: 15,    baseAtk: 2,   interval: 1.0,  sprite: 'mugi',    desc: '最初の仲間。そこそこ強く、そこそこ速い。' },
    mage:     { id: 'mage',     name: 'ねこ魔道士',   role: '高火力低速', unlockTotalLv: 10,  baseCost: 100,   baseAtk: 9,   interval: 1.6,  sprite: 'luna',    desc: '詠唱は遅いが一撃が重い。' },
    archer:   { id: 'archer',   name: '弓かざし職人', role: '速攻',       unlockTotalLv: 30,  baseCost: 1100,  baseAtk: 22,  interval: 0.6,  sprite: 'slinger', desc: '矢をつまみ撃つ速射の名手。' },
    guardian: { id: 'guardian', name: '盾持ち巨猫',   role: '高HP壁',     unlockTotalLv: 60,  baseCost: 12000, baseAtk: 65,  interval: 1.4,  sprite: 'toto',    desc: '巨体で押し込む、塔の守り手。' },
    ninja:    { id: 'ninja',    name: '忍者ねこ',     role: '超高速',     unlockTotalLv: 100, baseCost: 130000, baseAtk: 180, interval: 0.35, sprite: 'kohaku',  desc: '残像が見えるほどの連撃。' }
  };
  const JOB_ORDER = ['warrior', 'mage', 'archer', 'guardian', 'ninja'];

  /* ------------------------------------------------------------------ *
   * §4.2 武器 WEAPONS (かじ屋)
   * 所持武器はすべて乗算。総購入数到達で次を解放。6個目以降は自動生成。
   * ------------------------------------------------------------------ */
  const WEAPONS = {
    wooden_claw:    { id: 'wooden_claw',    name: '木の爪',   cost: 50,     mult: 1.5, unlockCount: 0, icon: '🪵' },
    iron_claw:      { id: 'iron_claw',      name: '鉄の爪',   cost: 400,    mult: 2,   unlockCount: 1, icon: '⚙️' },
    fire_sword:     { id: 'fire_sword',     name: '炎の剣',   cost: 3000,   mult: 2.5, unlockCount: 2, icon: '🔥' },
    ice_spear:      { id: 'ice_spear',      name: '氷の槍',   cost: 25000,  mult: 3,   unlockCount: 3, icon: '❄️' },
    thunder_hammer: { id: 'thunder_hammer', name: '雷の槌',   cost: 200000, mult: 4,   unlockCount: 4, icon: '⚡' }
  };
  const WEAPON_ORDER = ['wooden_claw', 'iron_claw', 'fire_sword', 'ice_spear', 'thunder_hammer'];

  // 6個目 (k=6) 以降の自動生成ルール: コスト ×10刻み、倍率 ×5, ×6, ×7...
  function generatedWeapon(k) { // k = 通算番号 (1始まり、k >= 6)
    return {
      id: 'gen_weapon_' + k,
      name: '古代の魔具 ' + (k - 5) + '号',
      cost: 200000 * Math.pow(10, k - 5),
      mult: k - 1,
      unlockCount: k - 1,
      icon: '🗡️',
      generated: true
    };
  }
  // 通算 k 番目の武器定義を返す (1始まり)
  function weaponAt(k) {
    if (k <= WEAPON_ORDER.length) return WEAPONS[WEAPON_ORDER[k - 1]];
    return generatedWeapon(k);
  }

  /* ------------------------------------------------------------------ *
   * §4.3 道具 ITEMS (道具屋) — %バフ、繰り返し購入可
   * ------------------------------------------------------------------ */
  const ITEMS = {
    lucky_coin:   { id: 'lucky_coin',   name: '幸運の鈴',     desc: '獲得コイン +25%/個',  baseCost: 200,  costMult: 1.9, icon: '🔔' },
    energy_drink: { id: 'energy_drink', name: '元気ドリンク', desc: '攻撃速度 +8%/個',     baseCost: 350,  costMult: 1.9, icon: '🥤' },
    boots:        { id: 'boots',        name: '疾風のくつ',   desc: '移動速度 +12%/個',    baseCost: 500,  costMult: 2.0, icon: '👢' },
    bell_charm:   { id: 'bell_charm',   name: '招集のお守り', desc: 'タップ招集数 +1/個',  baseCost: 1500, costMult: 3.0, icon: '🧿' }
  };
  const ITEM_ORDER = ['lucky_coin', 'energy_drink', 'boots', 'bell_charm'];

  /* ------------------------------------------------------------------ *
   * §4.5 建店 SHOP_TYPES (制圧階への建店 3択)
   * 同種店ボーナス: 2店目×1.5、3店目×2 (効果側)
   * ------------------------------------------------------------------ */
  const SHOP_TYPES = {
    diner:  { id: 'diner',  name: '魚食堂',   icon: '🐟', desc: 'コイン/秒 +f(階)',      worker: 'guard'  },
    armory: { id: 'armory', name: '武器蔵',   icon: '🛡️', desc: '全攻撃 +15%',          worker: 'runner' },
    guild:  { id: 'guild',  name: '派遣支所', icon: '🐾', desc: 'オート出撃間隔 -12%',   worker: 'runner' },
    bank:   { id: 'bank',   name: '金貨倉庫', icon: '🏦', desc: 'オフライン効率 +15%',   worker: 'guard'  }
  };
  const SHOP_ORDER = ['diner', 'armory', 'guild', 'bank'];
  // 魚食堂の収益 f(階): 建てた階 × 2 コイン/秒
  function dinerIncome(floorN) { return 2 * floorN; }
  // 同種 n 店目 (1始まり) の効果係数: 1, 1.5, 2, 2, ...
  function sameShopFactor(n) { return n <= 1 ? 1 : (n === 2 ? 1.5 : 2); }

  /* ------------------------------------------------------------------ *
   * §4.6 宝物庫 TREASURES (夜明けの✨で買う永続パッシブ)
   * ------------------------------------------------------------------ */
  const TREASURES = {
    seed_money:  { id: 'seed_money',  name: '開業資金',   cost: 3,  icon: '💰', desc: '初期コイン ×3' },
    war_drum:    { id: 'war_drum',    name: '出陣の太鼓', cost: 5,  icon: '🥁', desc: '全攻撃 +50%' },
    ledger:      { id: 'ledger',      name: '黄金の帳簿', cost: 5,  icon: '📒', desc: '収益 +50%' },
    extra_slot:  { id: 'extra_slot',  name: '増員の笛',   cost: 8,  icon: '🎺', desc: 'オート出撃 +1枠' },
    shortcut:    { id: 'shortcut',    name: '近道の地図', cost: 10, icon: '🗺️', desc: '開始階 +5' }
  };
  const TREASURE_ORDER = ['seed_money', 'war_drum', 'ledger', 'extra_slot', 'shortcut'];

  /* ------------------------------------------------------------------ *
   * §4.4 敵・階 FLOORS (数値式)
   * 守護者HP: 20 × 1.28^(N-1)、ボス階(5,10,15...)は ×10 / 報酬 ×8
   * ザコ 0〜3体 (HPは守護者の8%/体)
   * 撃破コイン: 4 × 1.22^(N-1) (ボス×8)
   * ------------------------------------------------------------------ */
  // 敵スプライト: 既存9体をローテーション (10階ごとに地区色調変更は描画側)
  const ENEMY_ROTATION = ['ash_mouse', 'soot_weasel', 'sack_mole', 'smoke_bat', 'spark_gecko', 'scrap_crow', 'ledger_owl'];
  const BOSS_SPRITES = ['blackwing_guard', 'kagetsubasa']; // 5,15,25..→0 / 10,20..→1

  function isBossFloor(n) { return n % 5 === 0; }
  function guardianHp(n) { return 20 * Math.pow(1.28, n - 1) * (isBossFloor(n) ? 10 : 1); }
  function addHp(n) { return guardianHp(n) * 0.08; }
  function floorCoins(n) { return 4 * Math.pow(1.22, n - 1) * (isBossFloor(n) ? 8 : 1); }
  function guardianSprite(n) {
    if (isBossFloor(n)) return BOSS_SPRITES[(Math.floor(n / 5) - 1) % 2 === 0 ? 0 : 1];
    return ENEMY_ROTATION[(n - 1) % ENEMY_ROTATION.length];
  }
  function addSprite(n, i) { return ENEMY_ROTATION[(n + i) % ENEMY_ROTATION.length]; }

  /* ------------------------------------------------------------------ *
   * バランス定数 (IDLE_DESIGN.md §4.6/§4.7/§5)
   * ------------------------------------------------------------------ */
  const BALANCE = {
    world: { width: 390 },
    autoDeployBase: 3,        // オート出撃: 3秒ごと (§5)
    tapInterval: 0.12,        // タップ招集 0.12秒間隔上限 (§5)
    fieldCatSpeed: 55,        // 猫の移動速度 px/秒 (疾風のくつで増加)
    guardianAttackInterval: 3.0,  // 守護者が猫を気絶させる間隔 (損失なし・入口へ戻るだけ)
    addAttackInterval: 4.5,
    maxFieldCats: 40,         // フィールド上の猫の上限 (描画は24体+×N)
    prestigeUnlockFloor: 10,  // 夜明け解放: 10F制圧後 (maxFloor >= 10)
    offlineMaxHours: 8,       // オフライン収益 上限8h
    offlineEfficiency: 0.5,   // オフライン効率 50%
    autosaveSec: 5,           // オートセーブ 5秒間隔
    saveKey: 'cats_tower_idle_v1'
  };

  /* ------------------------------------------------------------------ *
   * スプライト資産 (visibleBounds は [x, y, w, h] 形式! anchors.json と同一)
   * displayHeight: 論理px (ワールド幅390px基準)
   * ------------------------------------------------------------------ */
  const A = (src, vb, foot, dh, tint) => ({
    src: src, visibleBounds: vb, footAnchor: foot, displayHeight: dh, fallback: { tint: tint }
  });

  const ASSETS = {
    cats: {
      mugi:    A('assets/prototype/cats/mugi.png',    [0.0225, 0.1875, 0.7549, 0.7666], [0.3999, 0.9541], 58, '#d8a45a'),
      luna:    A('assets/prototype/cats/luna.png',    [0.0225, 0.2637, 0.8545, 0.6904], [0.4497, 0.9541], 58, '#9a8ae0'),
      slinger: A('assets/prototype/cats/slinger.png', [0.0225, 0.2051, 0.7275, 0.7490], [0.3862, 0.9541], 56, '#7ab8d8'),
      toto:    A('assets/prototype/cats/toto.png',    [0.0225, 0.0654, 0.9492, 0.9082], [0.4971, 0.9736], 66, '#e0e0e8'),
      kohaku:  A('assets/prototype/cats/kohaku.png',  [0.0000, 0.2646, 0.9629, 0.6895], [0.4814, 0.9541], 54, '#d86a6a'),
      guard:   A('assets/prototype/cats/guard.png',   [0.0225, 0.1455, 0.7500, 0.8086], [0.3975, 0.9541], 60, '#8a9ab0'),
      runner:  A('assets/prototype/cats/runner.png',  [0.0225, 0.3105, 0.7412, 0.6436], [0.3931, 0.9541], 54, '#c8b06a')
    },
    enemies: {
      ash_mouse:       A('assets/prototype/enemies/ash_mouse.png',       [0.1055, 0.2266, 0.8242, 0.5078], [0.5176, 0.7344], 52,  '#8a8a92'),
      soot_weasel:     A('assets/prototype/enemies/soot_weasel.png',     [0.0469, 0.2734, 0.9258, 0.3750], [0.5098, 0.6484], 48,  '#6a6258'),
      sack_mole:       A('assets/prototype/enemies/sack_mole.png',       [0.1641, 0.1797, 0.6836, 0.6250], [0.5059, 0.8047], 58,  '#7a6a52'),
      smoke_bat:       A('assets/prototype/enemies/smoke_bat.png',       [0.0273, 0.1680, 0.9492, 0.6094], [0.5020, 0.7773], 56,  '#5a5468'),
      spark_gecko:     A('assets/prototype/enemies/spark_gecko.png',     [0.0391, 0.1367, 0.9414, 0.6133], [0.5098, 0.7500], 50,  '#c8a83a'),
      scrap_crow:      A('assets/prototype/enemies/scrap_crow.png',      [0.0225, 0.2090, 0.8633, 0.7451], [0.4541, 0.9541], 54,  '#3a3f4a'),
      ledger_owl:      A('assets/prototype/enemies/ledger_owl.png',      [0.1328, 0.0742, 0.6523, 0.8320], [0.4590, 0.9062], 72,  '#a08a5a'),
      blackwing_guard: A('assets/prototype/enemies/blackwing_guard.png', [0.1836, 0.0273, 0.6250, 0.8828], [0.4961, 0.9102], 150, '#2a2e3a'),
      kagetsubasa:     A('assets/prototype/enemies/kagetsubasa.png',     [0.0186, 0.0703, 0.9619, 0.8838], [0.4995, 0.9541], 170, '#1a1c26')
    },
    bg: {
      title:        { src: 'assets/prototype/bg/title.png' },
      floor_ruined: { src: 'assets/prototype/bg/floor_ruined.png', fallback: { top: '#2b2f3c', bottom: '#1a1c26' } },
      floor_living: { src: 'assets/prototype/bg/floor_living.png', fallback: { top: '#4a3a2c', bottom: '#2a2018' } }
    }
  };

  const EXPORT = {
    JOBS, JOB_ORDER,
    WEAPONS, WEAPON_ORDER, weaponAt, generatedWeapon,
    ITEMS, ITEM_ORDER,
    SHOP_TYPES, SHOP_ORDER, dinerIncome, sameShopFactor,
    TREASURES, TREASURE_ORDER,
    ENEMY_ROTATION, BOSS_SPRITES,
    isBossFloor, guardianHp, addHp, floorCoins, guardianSprite, addSprite,
    BALANCE, ASSETS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORT;
  global.GAME_DATA = EXPORT;
})(typeof window !== 'undefined' ? window : globalThis);
