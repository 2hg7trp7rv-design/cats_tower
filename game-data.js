/* =========================================================================
 * Cat's Tower — 商人サーガ忠実版 (CLONE_DESIGN.md 準拠)
 * game-data.js : データ定義正本 (CLONE_DESIGN.md §2〜§8)
 *
 * 職業5種 / 武器6種+自動生成(属性つき) / 道具4種 / 建店2種(武器屋・道具屋) /
 * 伝説の道具屋 / 階・敵の数値式(撃破数制圧)。
 * スプライト契約: visibleBounds は [x, y, w, h] 形式 (anchors.json と同一)。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * §2 職業 JOBS (人材派遣屋)
   * 雇用コスト: base × 1.16^owned / Lvアップコスト: base × 0.8 × 1.22^lv
   * レベルで攻撃力 +25%/Lv (Lv1 = base)
   * ------------------------------------------------------------------ */
  const JOBS = {
    warrior:  { id: 'warrior',  name: '戦士ねこ',     role: 'バランス',   unlockTotalLv: 0,   baseCost: 15,    baseAtk: 2,   interval: 1.0,  sprite: 'mugi',    desc: '最初の仲間。そこそこ強く、そこそこ速い。' },
    mage:     { id: 'mage',     name: '魔法使いねこ', role: '高火力低速', unlockTotalLv: 10,  baseCost: 100,   baseAtk: 9,   interval: 1.6,  sprite: 'luna',    desc: '詠唱は遅いが一撃が重い。' },
    archer:   { id: 'archer',   name: '弓使いねこ',   role: '速攻',       unlockTotalLv: 30,  baseCost: 1100,  baseAtk: 22,  interval: 0.6,  sprite: 'slinger', desc: '矢をつまみ撃つ速射の名手。' },
    guardian: { id: 'guardian', name: '騎士ねこ',     role: '高火力',     unlockTotalLv: 60,  baseCost: 12000, baseAtk: 65,   interval: 1.4,  sprite: 'toto',    desc: '巨体で押し込む、塔の守り手。' },
    ninja:    { id: 'ninja',    name: '忍者ねこ',     role: '超高速',     unlockTotalLv: 100, baseCost: 130000, baseAtk: 180, interval: 0.35, sprite: 'kohaku',  desc: '残像が見えるほどの連撃。' }
  };
  const JOB_ORDER = ['warrior', 'mage', 'archer', 'guardian', 'ninja'];

  /* ------------------------------------------------------------------ *
   * §3/§6 属性 ELEMENTS
   * 敵は階ローテーションで属性を持つ。弱点属性の武器を1本でも所持で
   * その敵への全ダメージ×1.5、耐性(同属性)のみなら×0.5。
   * weak: 弱点属性 / mark: 敵アイコン横の属性マーク。
   * ------------------------------------------------------------------ */
  const ELEMENTS = {
    none:    { id: 'none',    name: '無属性', mark: '',   weak: null },
    fire:    { id: 'fire',    name: '炎',     mark: '🔥', weak: 'ice' },
    ice:     { id: 'ice',     name: '氷',     mark: '❄️', weak: 'thunder' },
    thunder: { id: 'thunder', name: '雷',     mark: '⚡', weak: 'fire' }
  };
  const ELEMENT_CYCLE = ['none', 'fire', 'ice', 'thunder'];
  // 階ごとに なし→炎→氷→雷 をローテーション (10階ごとの地区色調と連動)
  function floorElement(n) { return ELEMENT_CYCLE[(n - 1) % 4]; }

  /* ------------------------------------------------------------------ *
   * §3 武器 WEAPONS (武器屋) — 属性つき
   * 所持武器はすべて乗算。総購入数到達(または武器屋ランク)で次を解放。
   * 購入には制圧階への武器屋建設が必要 (建設数=武器屋ランク)。
   * 6個目以降は自動生成 (属性は 炎→氷→雷 で循環)。
   * ------------------------------------------------------------------ */
  const WEAPONS = {
    wooden_claw:    { id: 'wooden_claw',    name: '木の剣', cost: 50,     mult: 1.5, unlockCount: 0, attr: 'none',    icon: '🗡️' },
    iron_claw:      { id: 'iron_claw',      name: '鉄の剣', cost: 400,    mult: 2,   unlockCount: 1, attr: 'none',    icon: '⚔️', unlockRank: 2 },
    fire_sword:     { id: 'fire_sword',     name: '炎の剣', cost: 3000,   mult: 2.5, unlockCount: 2, attr: 'fire',    icon: '🔥' },
    ice_spear:      { id: 'ice_spear',      name: '氷の槍', cost: 25000,  mult: 3,   unlockCount: 3, attr: 'ice',     icon: '❄️' },
    thunder_hammer: { id: 'thunder_hammer', name: '雷の槌', cost: 200000, mult: 4,   unlockCount: 4, attr: 'thunder', icon: '⚡' }
  };
  const WEAPON_ORDER = ['wooden_claw', 'iron_claw', 'fire_sword', 'ice_spear', 'thunder_hammer'];

  // 6個目 (k=6) 以降の自動生成ルール: コスト ×10刻み、倍率 ×5, ×6, ×7...
  // 属性は 炎→氷→雷 で循環
  const GEN_ATTRS = ['fire', 'ice', 'thunder'];
  const GEN_NAMES = { fire: '聖なる', ice: '凍てつく', thunder: '轟く' };
  function generatedWeapon(k) { // k = 通算番号 (1始まり、k >= 6)
    const attr = GEN_ATTRS[(k - 6) % 3];
    return {
      id: 'gen_weapon_' + k,
      name: GEN_NAMES[attr] + '魔具 ' + (k - 5) + '号',
      cost: 200000 * Math.pow(10, k - 5),
      mult: k - 1,
      unlockCount: k - 1,
      attr: attr,
      icon: ELEMENTS[attr].mark,
      generated: true
    };
  }
  // 通算 k 番目の武器定義を返す (1始まり)
  function weaponAt(k) {
    if (k <= WEAPON_ORDER.length) return WEAPONS[WEAPON_ORDER[k - 1]];
    return generatedWeapon(k);
  }

  /* ------------------------------------------------------------------ *
   * §4 道具 ITEMS (道具屋) — %バフ、繰り返し購入可
   * 購入には制圧階への道具屋建設が必要 (建設数=道具屋ランク)。
   * unlockRank: 道具屋ランクがこの値以上で品ぞろえ解放。
   * ------------------------------------------------------------------ */
  const ITEMS = {
    lucky_coin:   { id: 'lucky_coin',   name: '金運のお守り', desc: '獲得コイン +25%/個',  baseCost: 200,  costMult: 1.9, icon: '🧧', unlockRank: 1 },
    energy_drink: { id: 'energy_drink', name: '疾風の薬',     desc: '攻撃速度 +8%/個',     baseCost: 350,  costMult: 1.9, icon: '🧪', unlockRank: 2 },
    boots:        { id: 'boots',        name: '軽業のくつ',   desc: '移動速度 +12%/個',    baseCost: 500,  costMult: 2.0, icon: '👢', unlockRank: 3 },
    bell_charm:   { id: 'bell_charm',   name: '勇者の笛',     desc: 'タップ招集数 +1/個',  baseCost: 1500, costMult: 3.0, icon: '🎺', unlockRank: 4 }
  };
  const ITEM_ORDER = ['lucky_coin', 'energy_drink', 'boots', 'bell_charm'];

  /* ------------------------------------------------------------------ *
   * §5 建店 SHOP_TYPES (制圧階への建店 2種: 武器屋・道具屋)
   * 建設数 = 店ランク。同種ボーナス: 2件目以降 対応効果 +10%/件。
   * 各店は建てた階 × 2 コイン/秒の売上も生む (オフライン収益の元)。
   * ------------------------------------------------------------------ */
  const SHOP_TYPES = {
    weapon: { id: 'weapon', name: '武器屋', icon: '⚔️', desc: '武器の購入が可能に / 武器効果 同種+10%/件', worker: 'runner' },
    item:   { id: 'item',   name: '道具屋', icon: '🎒', desc: '道具の購入が可能に / 道具効果 同種+10%/件', worker: 'guard' }
  };
  const SHOP_ORDER = ['weapon', 'item'];
  // 旧版(放置クリッカー版)セーブの店種読み替え: 武器蔵→武器屋、他→道具屋
  const LEGACY_SHOP_MAP = { armory: 'weapon', diner: 'item', guild: 'item', bank: 'item' };
  // 店の売上 f(階): 建てた階 × 2 コイン/秒 (旧魚食堂と同じ式)
  function shopIncome(floorN) { return 2 * floorN; }

  /* ------------------------------------------------------------------ *
   * §7 伝説の道具屋 TREASURES (転生の💎ルビーで買う永続パッシブ)
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
   * §6 敵・階 FLOORS (数値式)
   * 通常階: ザコ連続出現 (同時1〜3体)。規定数 8+階×2 体撃破で制圧。
   *   ザコ1体のHP/コインは階の総量を按分 (数値式は現行維持)。
   * ボス階(5の倍数): ボス1体。HP ×10 / 報酬 ×8 / 王冠表示。
   * 階HP(現行式): 20 × 1.28^(N-1) / 撃破コイン(現行式): 4 × 1.22^(N-1)
   * ------------------------------------------------------------------ */
  // 敵スプライト: 既存9体をローテーション (10階ごとに地区色調変更は描画側)
  const ENEMY_ROTATION = ['ash_mouse', 'soot_weasel', 'sack_mole', 'smoke_bat', 'spark_gecko', 'scrap_crow', 'ledger_owl'];
  const BOSS_SPRITES = ['blackwing_guard', 'kagetsubasa']; // 5,15,25..→0 / 10,20..→1

  function isBossFloor(n) { return n % 5 === 0; }
  function killNeed(n) { return 8 + n * 2; } // 通常階の撃破規定数
  function floorHp(n) { return 20 * Math.pow(1.28, n - 1); } // 通常階の総HP
  function guardianHp(n) { return floorHp(n) * (isBossFloor(n) ? 10 : 1); } // ボスHP
  function addHp(n) { return floorHp(n) / killNeed(n); } // ザコ1体のHP (按分)
  function floorCoins(n) { return 4 * Math.pow(1.22, n - 1) * (isBossFloor(n) ? 8 : 1); } // 階の総コイン
  function addCoins(n) { return 4 * Math.pow(1.22, n - 1) / killNeed(n); } // ザコ1体のコイン (按分)
  function guardianSprite(n) {
    if (isBossFloor(n)) return BOSS_SPRITES[(Math.floor(n / 5) - 1) % 2 === 0 ? 0 : 1];
    return ENEMY_ROTATION[(n - 1) % ENEMY_ROTATION.length];
  }
  function addSprite(n, i) { return ENEMY_ROTATION[(n + i) % ENEMY_ROTATION.length]; }

  /* ------------------------------------------------------------------ *
   * §8 イントロ (開始時に1枚表示・スキップ可)
   * ------------------------------------------------------------------ */
  const INTRO_TEXT =
    '魔王に城下町を追われた商人の猫「ムギ」。\n' +
    'しかし商才だけは魔王城でも通用する——\n' +
    '塔の1階に店を開き、勇者ねこたちを雇って\n' +
    'てっぺんの魔王を目指す、生意気な商売が始まる。\n' +
    '(ムギは戦いません。招集と経営で勇者を支えましょう)';

  /* ------------------------------------------------------------------ *
   * バランス定数 (CLONE_DESIGN.md §6/§7/§9)
   * ------------------------------------------------------------------ */
  const BALANCE = {
    world: { width: 390 },
    autoDeployBase: 3,        // オート出撃: 3秒ごと
    tapInterval: 0.12,        // タップ招集 0.12秒間隔上限
    fieldCatSpeed: 55,        // 猫の移動速度 px/秒 (軽業のくつで増加)
    bossAttackInterval: 3.0,  // ボスが猫を気絶させる間隔 (損失なし・入口へ戻るだけ)
    addAttackInterval: 4.5,
    maxFieldCats: 42,         // フィールド上の猫の上限 (描画は24体+×N)
    maxFieldEnemies: 3,       // ザコの同時出現上限 (1〜3体)
    prestigeUnlockFloor: 10,  // 転生解放: 10F制圧後 (maxFloor >= 10)
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

  /* ------------------------------------------------------------------ *
   * 和風単位フォーマッタ fmt (4桁区切り・上位2グループ連結)
   *   1万未満: 整数そのまま (例 "9999")
   *   例: 123450000 → "1億2345万" / 582266×10^60 → "58不2266那"
   *   単位: 万 億 兆 京 垓 秭 穣 溝 澗 正 載 極 恒(河沙) 阿(僧祇) 那(由他)
   *         不(可思議) 無(量大数)
   * ------------------------------------------------------------------ */
  const W_UNITS = ['万', '億', '兆', '京', '垓', '秭', '穣', '溝', '澗', '正', '載', '極', '恒', '阿', '那', '不', '無'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    n = Math.floor(Number(n) || 0);
    if (n < 0) return '-' + fmt(-n);
    if (n < 10000) return String(n);
    // 4桁ごとのグループに分解 (groups[0]=下位)
    const groups = [];
    while (n > 0) { groups.push(n % 10000); n = Math.floor(n / 10000); }
    // 「無」より上の桁は最上位グループに畳み込む
    const maxIdx = W_UNITS.length; // groups.length-1 の上限 (=16 → 単位「無」)
    if (groups.length - 1 > maxIdx) {
      let val = 0;
      for (let i = groups.length - 1; i >= maxIdx; i--) val = val * 10000 + groups[i];
      groups.length = maxIdx + 1;
      groups[maxIdx] = val;
    }
    const top = groups.length - 1; // >= 1
    let s = groups[top] + W_UNITS[top - 1];
    if (top - 1 >= 1 && groups[top - 1] > 0) {
      s += String(groups[top - 1]).padStart(4, '0') + W_UNITS[top - 2];
    }
    return s;
  }

  const EXPORT = {
    JOBS, JOB_ORDER,
    fmt,
    ELEMENTS, ELEMENT_CYCLE, floorElement,
    WEAPONS, WEAPON_ORDER, weaponAt, generatedWeapon,
    ITEMS, ITEM_ORDER,
    SHOP_TYPES, SHOP_ORDER, LEGACY_SHOP_MAP, shopIncome,
    TREASURES, TREASURE_ORDER,
    ENEMY_ROTATION, BOSS_SPRITES,
    isBossFloor, killNeed, floorHp, guardianHp, addHp, floorCoins, addCoins,
    guardianSprite, addSprite,
    INTRO_TEXT,
    BALANCE, ASSETS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORT;
  global.GAME_DATA = EXPORT;
})(typeof window !== 'undefined' ? window : globalThis);
