/* =========================================================================
 * Cat's Tower — 戦闘プロトタイプ (kimiブランチ)
 * game-data.js : 全ゲームデータ定義
 *
 * 内容:
 *   - ASSETS      : assets/prototype/** の画像パスとアンカーメタデータ
 *                   (MASTER_SPEC §7.1)。画像実寸が確定したら各エントリの
 *                   footAnchor / displayScale だけを調整すればよい構造。
 *   - CATS        : 名前付き猫4匹 (FLOORS_1_10_DESIGN §4)
 *   - HELPERS     : 一時増援3役割 (同 §5)
 *   - ENEMIES     : 通常敵6種 + エリート2 + ボス (同 §6〜§8)
 *   - SHOPS       : ショップ4種 (同 §9)
 *   - RELICS      : 9F遺物3択 (同 §11.9)
 *   - FLOORS      : 1〜10F 各階進行 (同 §11)
 *   - BALANCE     : プロトタイプ仮バランス値 (UI文言・ロジックへ直書きしない)
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
   * ASSETS
   * 全キャラ素材は透過PNG・1:1・右向き側面・ピクセルアート調。
   * アンカー座標は画像幅/高さに対する比率 (0.0〜1.0)。
   *   footAnchor    : 足裏の基準点。床 floorGroundY に一致させる
   *   headAnchor    : 頭頂の基準点 (HPバー・名称表示の基準)
   *   shadowAnchor  : 影の中心と幅 (影は床に描く)
   *   contactAnchor : 攻撃が接触する基準点 (エフェクトの起点)
   *   displayScale  : 390px幅での基準表示高さ (CSS px, §7.3の範囲)
   * 画像が未生成でも起動し、fallback 描画 (tint/silhouette) で表示する。
   * ------------------------------------------------------------------- */
  const ASSET_BASE = 'assets/prototype/';

  const ASSETS = {
    cats: {
      mugi:   { src: ASSET_BASE + 'cats/mugi.png',   displayHeight: 88, visibleBounds: [0.0225, 0.1875, 0.7549, 0.7666], footAnchor: { x: 0.3999, y: 0.9541 }, headAnchor: { x: 0.3999, y: 0.1875 }, shadowAnchor: { x: 0.3999, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.7773, y: 0.5708 }, fallback: { tint: '#e0a44f', accent: '#8a5a22', label: 'ムギ' } },
      luna:   { src: ASSET_BASE + 'cats/luna.png',   displayHeight: 84, visibleBounds: [0.0225, 0.2637, 0.8545, 0.6904], footAnchor: { x: 0.4497, y: 0.9541 }, headAnchor: { x: 0.4497, y: 0.2637 }, shadowAnchor: { x: 0.4497, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.8770, y: 0.6089 }, fallback: { tint: '#b9c7f2', accent: '#4a5a9e', label: 'ルナ' } },
      toto:   { src: ASSET_BASE + 'cats/toto.png',   displayHeight: 78, visibleBounds: [0.0225, 0.0654, 0.9492, 0.9082], footAnchor: { x: 0.4971, y: 0.9736 }, headAnchor: { x: 0.4971, y: 0.0654 }, shadowAnchor: { x: 0.4971, y: 0.9736, w: 0.62 }, contactAnchor: { x: 0.9717, y: 0.5195 }, fallback: { tint: '#f2e3c9', accent: '#b06a5a', label: 'トト' } },
      kohaku: { src: ASSET_BASE + 'cats/kohaku.png', displayHeight: 68, visibleBounds: [0.0000, 0.2646, 0.9629, 0.6895], footAnchor: { x: 0.4814, y: 0.9541 }, headAnchor: { x: 0.4814, y: 0.2646 }, shadowAnchor: { x: 0.4814, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.9629, y: 0.6094 }, fallback: { tint: '#f0864a', accent: '#7a3a16', label: 'コハク' } },
      guard:   { src: ASSET_BASE + 'cats/guard.png',   displayHeight: 76, visibleBounds: [0.0225, 0.1455, 0.7500, 0.8086], footAnchor: { x: 0.3975, y: 0.9541 }, headAnchor: { x: 0.3975, y: 0.1455 }, shadowAnchor: { x: 0.3975, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.7725, y: 0.5498 }, fallback: { tint: '#9aa7b8', accent: '#3f4c60', label: 'ガード' } },
      slinger: { src: ASSET_BASE + 'cats/slinger.png', displayHeight: 60, visibleBounds: [0.0225, 0.2051, 0.7275, 0.7490], footAnchor: { x: 0.3862, y: 0.9541 }, headAnchor: { x: 0.3862, y: 0.2051 }, shadowAnchor: { x: 0.3862, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.7500, y: 0.5796 }, fallback: { tint: '#a8c48a', accent: '#4a6a34', label: 'スリンガー' } },
      runner:  { src: ASSET_BASE + 'cats/runner.png',  displayHeight: 72, visibleBounds: [0.0225, 0.3105, 0.7412, 0.6436], footAnchor: { x: 0.3931, y: 0.9541 }, headAnchor: { x: 0.3931, y: 0.3105 }, shadowAnchor: { x: 0.3931, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.7637, y: 0.6323 }, fallback: { tint: '#e8c46a', accent: '#8a6a1a', label: 'ランナー' } }
    },
    enemies: {
      ash_mouse:       { src: ASSET_BASE + 'enemies/ash_mouse.png',       displayHeight: 84,  visibleBounds: [0.1055, 0.2266, 0.8242, 0.5078], footAnchor: { x: 0.5176, y: 0.7344 }, headAnchor: { x: 0.5176, y: 0.2266 }, shadowAnchor: { x: 0.5176, y: 0.7344, w: 0.62 }, contactAnchor: { x: 0.1055, y: 0.4805 }, fallback: { tint: '#8d8d94', accent: '#4c4c52', label: '灰ネズミ' } },
      soot_weasel:     { src: ASSET_BASE + 'enemies/soot_weasel.png',     displayHeight: 86,  visibleBounds: [0.0469, 0.2734, 0.9258, 0.3750], footAnchor: { x: 0.5098, y: 0.6484 }, headAnchor: { x: 0.5098, y: 0.2734 }, shadowAnchor: { x: 0.5098, y: 0.6484, w: 0.62 }, contactAnchor: { x: 0.0469, y: 0.4609 }, fallback: { tint: '#5a4a42', accent: '#2e2420', label: 'すすイタチ' } },
      sack_mole:       { src: ASSET_BASE + 'enemies/sack_mole.png',       displayHeight: 96,  visibleBounds: [0.1641, 0.1797, 0.6836, 0.6250], footAnchor: { x: 0.5059, y: 0.8047 }, headAnchor: { x: 0.5059, y: 0.1797 }, shadowAnchor: { x: 0.5059, y: 0.8047, w: 0.62 }, contactAnchor: { x: 0.1641, y: 0.4922 }, fallback: { tint: '#6a5a48', accent: '#8a7a5a', label: '袋モグラ' } },
      scrap_crow:      { src: ASSET_BASE + 'enemies/scrap_crow.png',      displayHeight: 90,  visibleBounds: [0.0225, 0.2090, 0.8633, 0.7451], footAnchor: { x: 0.4541, y: 0.9541 }, headAnchor: { x: 0.4541, y: 0.2090 }, shadowAnchor: { x: 0.4541, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.0225, y: 0.5815 }, fallback: { tint: '#3a3f4c', accent: '#c8b04a', label: 'くず鉄カラス' } },
      smoke_bat:       { src: ASSET_BASE + 'enemies/smoke_bat.png',       displayHeight: 84,  visibleBounds: [0.0273, 0.1680, 0.9492, 0.6094], footAnchor: { x: 0.5020, y: 0.7773 }, headAnchor: { x: 0.5020, y: 0.1680 }, shadowAnchor: { x: 0.5020, y: 0.7773, w: 0.62 }, contactAnchor: { x: 0.0273, y: 0.4727 }, fallback: { tint: '#5c5468', accent: '#9a92ac', label: '煙コウモリ' } },
      spark_gecko:     { src: ASSET_BASE + 'enemies/spark_gecko.png',     displayHeight: 88,  visibleBounds: [0.0391, 0.1367, 0.9414, 0.6133], footAnchor: { x: 0.5098, y: 0.7500 }, headAnchor: { x: 0.5098, y: 0.1367 }, shadowAnchor: { x: 0.5098, y: 0.7500, w: 0.62 }, contactAnchor: { x: 0.0391, y: 0.4434 }, fallback: { tint: '#4a8a6a', accent: '#ffd25a', label: '火花ヤモリ' } },
      ledger_owl:      { src: ASSET_BASE + 'enemies/ledger_owl.png',      displayHeight: 112, visibleBounds: [0.1328, 0.0742, 0.6523, 0.8320], footAnchor: { x: 0.4590, y: 0.9062 }, headAnchor: { x: 0.4590, y: 0.0742 }, shadowAnchor: { x: 0.4590, y: 0.9062, w: 0.62 }, contactAnchor: { x: 0.1328, y: 0.4902 }, fallback: { tint: '#6a5a7a', accent: '#e8d9a0', label: '帳場フクロウ' } },
      blackwing_guard: { src: ASSET_BASE + 'enemies/blackwing_guard.png', displayHeight: 96, visibleBounds: [0.1836, 0.0273, 0.6250, 0.8828], footAnchor: { x: 0.4961, y: 0.9102 }, headAnchor: { x: 0.4961, y: 0.0273 }, shadowAnchor: { x: 0.4961, y: 0.9102, w: 0.62 }, contactAnchor: { x: 0.1836, y: 0.4688 }, fallback: { tint: '#2c3038', accent: '#c0392b', label: '黒羽番兵' } },
      kagetsubasa:     { src: ASSET_BASE + 'enemies/kagetsubasa.png',     displayHeight: 142, visibleBounds: [0.0186, 0.0703, 0.9619, 0.8838], footAnchor: { x: 0.4995, y: 0.9541 }, headAnchor: { x: 0.4995, y: 0.0703 }, shadowAnchor: { x: 0.4995, y: 0.9541, w: 0.62 }, contactAnchor: { x: 0.0186, y: 0.5122 }, fallback: { tint: '#23262e', accent: '#e04a3a', label: 'カゲツバサ' } }
    },
    bg: {
      floor_ruined: { src: ASSET_BASE + 'bg/floor_ruined.png', fallback: { top: '#3a3d46', bottom: '#23252c', ground: '#4a4d56' } },
      floor_living: { src: ASSET_BASE + 'bg/floor_living.png', fallback: { top: '#5a4632', bottom: '#33261a', ground: '#6a563c' } },
      title:        { src: ASSET_BASE + 'bg/title.png',        fallback: { top: '#1b2030', bottom: '#0f1220', ground: '#2a3040' } }
    },
    shops: {
      guild:      { src: ASSET_BASE + 'shops/guild.png',      fallback: { tint: '#c8a24a', icon: '📋' } },
      fish_diner: { src: ASSET_BASE + 'shops/fish_diner.png', fallback: { tint: '#4a9ec8', icon: '🐟' } },
      claw_forge: { src: ASSET_BASE + 'shops/claw_forge.png', fallback: { tint: '#c85a4a', icon: '⚒️' } },
      clinic:     { src: ASSET_BASE + 'shops/clinic.png',     fallback: { tint: '#5ac88a', icon: '💊' } }
    }
  };

  /* ---------------------------------------------------------------------
   * 名前付き猫4匹 (FLOORS_1_10_DESIGN §4)
   * ------------------------------------------------------------------- */
  const CATS = {
    mugi: {
      id: 'mugi', name: 'ムギ', role: 'vanguard', roleName: '前衛・足止め',
      desc: '小さな木盾で最前列を止める、がっしりした前衛。',
      unlock: { type: 'start', label: '最初から仲間' },
      hp: 130, atk: 8, interval: 1.35, range: 26, speed: 170, windup: 0.28,
      canHitFlying: 'swoop', signature: 'shieldStance'
    },
    luna: {
      id: 'luna', name: 'ルナ', role: 'ranged', roleName: '遠距離・対空',
      desc: 'しなやかな狙撃手。飛行敵を優先して撃つ。',
      unlock: { type: 'deliveries', need: 3, label: '2F制圧後、3Fの物資昇降機へ補給箱を3回到着させる' },
      hp: 80, atk: 10, interval: 1.7, range: 400, speed: 170, windup: 0.32,
      projectile: 'stone', canHitFlying: 'always', signature: 'steadyAim'
    },
    toto: {
      id: 'toto', name: 'トト', role: 'healer', roleName: '支援・回復',
      desc: '小柄で丸い診療猫。傷ついた仲間に包帯を投げる。',
      unlock: { type: 'rescue', floor: 5, label: '5Fの救出戦を制圧する' },
      hp: 90, atk: 0, heal: 14, interval: 2.2, range: 400, speed: 160, windup: 0.3,
      projectile: 'bandage', canHitFlying: 'never', signature: 'waveHeal'
    },
    kohaku: {
      id: 'kohaku', name: 'コハク', role: 'runner', roleName: '走者・後列妨害',
      desc: '細身の疾走猫。前衛をすり抜けて後列の援護敵を止める。',
      unlock: { type: 'kohaku3', label: 'ショップ2種類以上 + 配送5回到着 + 8Fで帳簿係を最初に倒す' },
      hp: 95, atk: 7, interval: 1.1, range: 24, speed: 260, windup: 0.22,
      canHitFlying: 'never', signature: 'interrupt'
    }
  };

  /* ---------------------------------------------------------------------
   * 一時増援3役割 (FLOORS_1_10_DESIGN §5)
   * ------------------------------------------------------------------- */
  const HELPERS = {
    guard:   { id: 'guard',   name: 'ガード',     role: 'vanguard', hp: 95, atk: 6, interval: 1.5, range: 24, speed: 175, windup: 0.26, canHitFlying: 'swoop', rally: '次の前衛へ小盾付与' },
    slinger: { id: 'slinger', name: 'スリンガー', role: 'ranged',   hp: 62, atk: 8, interval: 1.8, range: 380, speed: 175, windup: 0.3,  projectile: 'stone', canHitFlying: 'always', rally: '次の弾を予約' },
    runner:  { id: 'runner',  name: 'ランナー',   role: 'runner',   hp: 72, atk: 6, interval: 1.2, range: 22, speed: 250, windup: 0.22, canHitFlying: 'never', rally: '配送速度の一時号令' }
  };

  /* ---------------------------------------------------------------------
   * 敵 (FLOORS_1_10_DESIGN §6〜§8)
   *   role: melee / flanker / shield / flying / support / elite / boss
   * ------------------------------------------------------------------- */
  const ENEMIES = {
    ash_mouse: {
      id: 'ash_mouse', name: '灰ネズミ', role: 'melee', roleName: '基礎近接',
      hp: 110, atk: 5, interval: 1.6, range: 24, speed: 46, windup: 0.34,
      flying: false, reward: 14, firstFloor: 1
    },
    soot_weasel: {
      id: 'soot_weasel', name: 'すすイタチ', role: 'flanker', roleName: '俊足・すり抜け',
      hp: 80, atk: 6, interval: 1.3, range: 22, speed: 92, windup: 0.3,
      flying: false, passThrough: true, reward: 18, firstFloor: 2
    },
    sack_mole: {
      id: 'sack_mole', name: '袋モグラ', role: 'shield', roleName: '盾・前衛保護',
      hp: 120, atk: 4, interval: 1.9, range: 24, speed: 26, windup: 0.4,
      flying: false, shieldReduce: 0.45, reward: 22, firstFloor: 3
    },
    scrap_crow: {
      id: 'scrap_crow', name: 'くず鉄カラス', role: 'flying', roleName: '飛行・遠距離',
      hp: 78, atk: 7, interval: 2.0, range: 150, speed: 60, windup: 0.42,
      flying: true, altitude: 96, swoop: true, projectile: 'scrap', reward: 24, firstFloor: 4
    },
    smoke_bat: {
      id: 'smoke_bat', name: '煙コウモリ', role: 'flying', roleName: '飛行・命中妨害',
      hp: 70, atk: 5, interval: 1.8, range: 120, speed: 66, windup: 0.4,
      flying: true, altitude: 110, swoop: true, projectile: 'smoke',
      debuff: { miss: 0.25, duration: 4 }, reward: 26, firstFloor: 5
    },
    spark_gecko: {
      id: 'spark_gecko', name: '火花ヤモリ', role: 'support', roleName: '後列支援・強化',
      hp: 90, atk: 3, interval: 2.4, range: 60, speed: 34, windup: 0.5,
      flying: false, buffAlly: { mult: 1.8, every: 6 }, reward: 30, firstFloor: 7
    },
    ledger_owl: {
      id: 'ledger_owl', name: '帳場フクロウ', role: 'elite', roleName: '指揮・増援召集',
      hp: 150, atk: 8, interval: 2.2, range: 90, speed: 24, windup: 0.6,
      flying: false, summon: { enemy: 'sack_mole', every: 12 }, reward: 60, firstFloor: 8
    },
    blackwing_guard: {
      id: 'blackwing_guard', name: '黒羽番兵', role: 'elite', roleName: '重装・範囲押し戻し',
      hp: 200, atk: 11, interval: 2.4, range: 30, speed: 20, windup: 0.62,
      flying: false, pushback: { every: 3, amount: 34 }, shieldReduce: 0.3, reward: 70, firstFloor: 8
    },
    kagetsubasa: {
      id: 'kagetsubasa', name: '黒羽代官カゲツバサ', role: 'boss', roleName: '地区ボス・3形態',
      hp: 520, atk: 13, interval: 2.0, range: 34, speed: 30, windup: 0.6,
      flying: false, reward: 400, firstFloor: 10,
      boss: {
        phases: [
          { key: 'levy',    name: '第1形態「徴収」',   hpFrom: 1.0,  hpTo: 0.66, minTime: 8,
            desc: '地上で大鎌。強攻撃前に帳簿印と床の赤線。配送箱を没収しようとする。' },
          { key: 'soar',    name: '第2形態「黒羽旋回」', hpFrom: 0.66, hpTo: 0.33, minTime: 9,
            desc: '飛行し地上前衛の射程外。カラスを呼び後列へ金属片。定期的に着地窓。' },
          { key: 'lockdown', name: '第3形態「封鎖命令」', hpFrom: 0.33, hpTo: 0, minTime: 9,
            desc: '盾行動+火花強化。入口を封じて増援を止める。帳簿係優先で解除。' }
        ]
      }
    }
  };

  /* ---------------------------------------------------------------------
   * ショップ4種 (FLOORS_1_10_DESIGN §9)
   * ------------------------------------------------------------------- */
  const SHOPS = {
    guild: {
      id: 'guild', name: '人材受付所', icon: '📋',
      boost: '増援が強くなる: 出撃枠+1、増援の攻撃+15%',
      deliveryItem: '募集札', deliveryIcon: '🪧',
      recommendFor: '増援回転不足・前線維持不足',
      worker: 'guard'
    },
    fish_diner: {
      id: 'fish_diner', name: '魚食堂', icon: '🐟',
      boost: '配送到着ごとに全員を小回復し、短い行動速度支援',
      deliveryItem: '魚料理', deliveryIcon: '🍽️',
      recommendFor: '回復不足・対空不足',
      worker: 'toto'
    },
    claw_forge: {
      id: 'claw_forge', name: '爪工房', icon: '⚒️',
      boost: '配送到着ごとに近接攻撃を強化し、盾を破砕しやすくする',
      deliveryItem: '爪カバーの小箱', deliveryIcon: '📦',
      recommendFor: '盾突破不足',
      worker: 'mugi'
    },
    clinic: {
      id: 'clinic', name: 'ねこ診療所', icon: '💊',
      boost: '配送到着ごとに負傷猫の復帰を早め、最も傷ついた猫を回復',
      deliveryItem: '包帯箱', deliveryIcon: '🩹',
      recommendFor: '回復不足',
      worker: 'toto'
    }
  };

  /* ---------------------------------------------------------------------
   * 9F 遺物3択 (FLOORS_1_10_DESIGN §11.9) — 周回中だけ有効
   * ------------------------------------------------------------------- */
  const RELICS = {
    soot_claw:     { id: 'soot_claw',     name: '煤払いの爪',   icon: '🐾', kind: '戦闘', desc: '近接ダメージ+25%。盾持ち敵への軽減を半分貫通する。' },
    resonant_bell: { id: 'resonant_bell', name: '共鳴する呼び鈴', icon: '🔔', kind: '増援', desc: '呼び鈴の連打間隔-30%。増援の体力+25%。' },
    warm_box:      { id: 'warm_box',      name: '温かな配達箱',  icon: '🎁', kind: '商業', desc: '配送の間隔-35%。配送到着時の効果+50%。' }
  };

  /* ---------------------------------------------------------------------
   * 1〜10F 各階進行 (FLOORS_1_10_DESIGN §11)
   *   waves: [[{e:敵id, lane, delay(出現秒)}...], ...]
   * ------------------------------------------------------------------- */
  const FLOORS = [
    null, // 1始まりに合わせるダミー
    {
      n: 1, name: '灰鈴の入口', kind: 'supply',
      teach: '呼び鈴、走行、接敵、命中',
      intro: '呼び鈴を押して、助っ人を呼ぼう',
      waves: [
        [{ e: 'ash_mouse', lane: 1, delay: 0.8 }]
      ],
      coinReward: 40,
      after: { type: 'supply', label: '灰鈴補給所' }
    },
    {
      n: 2, name: '空き店舗', kind: 'shop',
      teach: '店舗を比較して選ぶ / すり抜け対策',
      intro: 'すすイタチは前衛の横を抜けて後列を狙う。早めに増援を呼ぼう',
      waves: [
        [{ e: 'ash_mouse', lane: 0, delay: 0.6 }, { e: 'soot_weasel', lane: 2, delay: 2.2 }]
      ],
      coinReward: 60,
      after: { type: 'shop-choice', candidates: ['guild', 'fish_diner'] }
    },
    {
      n: 3, name: '止まった昇降機', kind: 'lift',
      teach: '盾と配送到着',
      intro: '袋モグラの袋盾は正面連打に強い。増援で囲もう',
      waves: [
        [{ e: 'sack_mole', lane: 1, delay: 0.6 }, { e: 'ash_mouse', lane: 2, delay: 2.0 }]
      ],
      coinReward: 80,
      after: { type: 'lift', label: '物資昇降機' }
    },
    {
      n: 4, name: '空の番台', kind: 'shop',
      teach: '遠距離・対空の読み',
      intro: 'くず鉄カラスは前衛を越えて後列を狙う。対空役で落とそう',
      waves: [
        [{ e: 'scrap_crow', lane: 1, delay: 0.8 }, { e: 'ash_mouse', lane: 0, delay: 1.6 }, { e: 'ash_mouse', lane: 2, delay: 3.0 }]
      ],
      coinReward: 100,
      after: { type: 'shop-choice', candidates: ['guild', 'fish_diner', 'claw_forge', 'clinic'] }
    },
    {
      n: 5, name: '閉じ込められた診療猫', kind: 'rescue',
      teach: '救出、編成、役割相性',
      intro: 'トトを守りながら戦おう。戦線が後退したら危険!',
      rescue: 'toto',
      waves: [
        [{ e: 'smoke_bat', lane: 0, delay: 0.8 }, { e: 'soot_weasel', lane: 1, delay: 2.0 }, { e: 'smoke_bat', lane: 2, delay: 3.6 }]
      ],
      coinReward: 130,
      after: { type: 'cat-room', label: 'トトの猫部屋' }
    },
    {
      n: 6, name: '二度鳴る鐘', kind: 'shop',
      teach: '次の波、回復持越し',
      intro: '2つの波が来る。体力と増援は次の波へ持ち越される',
      waves: [
        [{ e: 'ash_mouse', lane: 0, delay: 0.6 }, { e: 'soot_weasel', lane: 2, delay: 1.8 }],
        [{ e: 'sack_mole', lane: 1, delay: 0.5 }, { e: 'scrap_crow', lane: 0, delay: 1.8 }]
      ],
      coinReward: 160,
      after: { type: 'shop-choice', candidates: ['guild', 'fish_diner', 'claw_forge', 'clinic'] }
    },
    {
      n: 7, name: '煤けた掲示板', kind: 'board',
      teach: '公開実績、条件追跡',
      intro: '火花ヤモリが仲間を強化する。後列のヤモリを優先しよう',
      waves: [
        [{ e: 'sack_mole', lane: 1, delay: 0.6 }, { e: 'spark_gecko', lane: 2, delay: 1.6 }, { e: 'ash_mouse', lane: 0, delay: 2.6 }]
      ],
      coinReward: 190,
      after: { type: 'board', label: '依頼掲示板' }
    },
    {
      n: 8, name: '黒羽封鎖門', kind: 'wall',
      teach: '敵役割の組合せ、夜明け予告',
      intro: '帳簿係が補充を手配している。帳簿係を先に倒すと門が止まる!',
      wall: true,
      waves: [
        [{ e: 'sack_mole', lane: 1, delay: 0.6, tag: 'gateFront' },
         { e: 'blackwing_guard', lane: 0, delay: 1.8 },
         { e: 'ledger_owl', lane: 2, delay: 2.6, tag: 'ledger' }]
      ],
      coinReward: 240,
      after: { type: 'shop-choice', candidates: ['guild', 'fish_diner', 'claw_forge', 'clinic'] }
    },
    {
      n: 9, name: '市場の記録係', kind: 'elite',
      teach: '優先標的、遺物3択',
      intro: '強敵が1体待つ。入階前に相手を確認しよう',
      eliteChoice: true, // 直近構成で ledger_owl / blackwing_guard を切替
      waves: [
        [{ e: 'ledger_owl', lane: 1, delay: 0.8, tag: 'eliteMain' }, { e: 'spark_gecko', lane: 0, delay: 2.2 }]
      ],
      wavesAlt: [
        [{ e: 'blackwing_guard', lane: 1, delay: 0.8, tag: 'eliteMain' }, { e: 'sack_mole', lane: 2, delay: 2.2 }]
      ],
      coinReward: 300,
      after: { type: 'memorial', label: '市場記念室', relic: true }
    },
    {
      n: 10, name: '灰鈴大広間', kind: 'boss',
      teach: '3形態、構成変更、地区制覇',
      intro: '黒羽代官カゲツバサ。3つの形態を見極めて戦おう',
      waves: [
        [{ e: 'kagetsubasa', lane: 1, delay: 1.2, tag: 'boss' }]
      ],
      coinReward: 500,
      after: { type: 'hall', label: '灰鈴大広間' }
    }
  ];

  /* ---------------------------------------------------------------------
   * プロトタイプ仮バランス値 (BALANCE_*)。最終値はシミュレーション工程で決定。
   * ------------------------------------------------------------------- */
  const BALANCE = {
    // ワールド座標 (論理幅390px)
    world: {
      width: 390,
      entryX: 36,          // 猫の入口
      enemyEntryX: 354,    // 敵の入口
      breachX: 22,         // 敵がここまで来ると敗北
      stairsX: 330,        // 制圧後の階段位置
      laneY: [0, -34, -68],// レーン縦オフセット (奥ほど上)
      laneScale: [1.0, 0.92, 0.84],
      flyShadowGap: 8      // 飛行敵の影と本体の高度表現
    },
    bell: {
      cooldown: 1.1,          // 短押しの最小間隔(秒)
      holdStart: 0.4,         // 長押し開始(秒) FLOORS §5: 400ms
      holdRepeat: 0.38,       // 長押し中の要求間隔
      maxHelpers: 3,          // 基本の同時増援枠
      guildBonusSlots: 1,     // 人材受付所で追加
      rallyDuration: 5,       // 満員時の号令(攻撃速度+)秒
      rallyHaste: 0.25
    },
    helperWeights: {          // 出る役割の重み (敵構成で変化)
      base: { guard: 3, slinger: 2, runner: 2 },
      vsFlying: { slinger: 5 },
      vsShield: { runner: 4 },
      vsSwarm: { guard: 4 }
    },
    run: {                    // 増援の走行 (MASTER_SPEC §6.1: 幅30〜45%, 650〜1000ms)
      distanceMin: 0.30, distanceMax: 0.45,
      timeMin: 0.65, timeMax: 1.0
    },
    combat: {
      hitstopWeak: 0.05, hitstopStrong: 0.08,  // ヒットストップ秒 (§6.2)
      strongEvery: 4,          // 強攻撃の周期(攻撃回数)
      strongMult: 1.7,
      telegraphMin: 0.4, telegraphMax: 0.8,    // 敵の強攻撃予告 (§6.3)
      shakeWeak: 2, shakeStrong: 5
    },
    floors: {
      hpScale: 1.18,   // 階ごとの敵HP倍率 (f-1乗)
      atkScale: 1.12,  // 階ごとの敵攻撃倍率
      conquestTime: 2.0,       // 制圧→登階アニメ総秒数 (§6.4: 1.6〜2.2)
      waveInterval: 2.6        // ウェーブ間
    },
    deliveries: {
      interval: 13,            // 各店の配送間隔(秒)
      travelPerFloor: 1.1,     // 1階あたり輸送時間
      healRatio: 0.16,         // 魚食堂の回復割合
      forgeBuff: 0.2, forgeBuffTime: 7,
      clinicHeal: 0.3
    },
    upgrades: {
      atk: { name: 'こうげき強化', icon: '⚔️', baseCost: 45, costMult: 1.55, perLevel: 0.18, desc: '猫全員の攻撃+18%' },
      hp:  { name: 'たいりょく強化', icon: '❤️', baseCost: 35, costMult: 1.55, perLevel: 0.18, desc: '猫全員の体力+18%' },
      bell:{ name: 'ベル共鳴', icon: '🔔', baseCost: 90, costMult: 2.2, perLevel: 0, max: 2, desc: '増援の同時枠+1' }
    },
    cats: {
      reviveTime: 14,       // 気絶した名前付き猫の復帰秒
      reviveHpRatio: 0.5
    },
    kohaku: { shopKinds: 2, deliveries: 5 },
    lunaSnipeDamage: 999     // ルナ解放演出の一撃 (4F初回のみ)
  };

  /* 敗北診断 (FLOORS_1_10_DESIGN §15) */
  const DIAGNOSIS = {
    frontline: { id: 'frontline', label: '前線維持不足', hint: '敵が入口まで押し込んだ。ムギ・ガード・人材受付所で前線を保とう', action: 'roster' },
    antiair:   { id: 'antiair',   label: '対空不足', hint: '飛行敵の被害が大きい。ルナ・スリンガー・魚食堂で対策しよう', action: 'roster' },
    shield:    { id: 'shield',    label: '盾突破不足', hint: '袋盾にダメージを吸われた。爪工房・後列優先で崩そう', action: 'shop' },
    backline:  { id: 'backline',  label: '後列到達不足', hint: '敵の支援詠唱が通った。コハク・ランナーで後列へ届けよう', action: 'roster' },
    recovery:  { id: 'recovery',  label: '回復不足', hint: '損失が回復を上回った。トト・診療所・魚食堂を頼ろう', action: 'shop' },
    rotation:  { id: 'rotation',  label: '増援回転不足', hint: '増援の空き時間が長い。人材受付所や長押し呼び込みを使おう', action: 'shop' }
  };

  const EXPORT = { ASSETS, CATS, HELPERS, ENEMIES, SHOPS, RELICS, FLOORS, BALANCE, DIAGNOSIS };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORT;
  global.GAME_DATA = EXPORT;
})(typeof window !== 'undefined' ? window : globalThis);
