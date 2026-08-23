/* =========================================================================
 * Cat's Tower — 戦闘プロトタイプ (kimiブランチ)
 * app.js : 描画・入力・音・画面遷移 (game-core.js のシミュレーションを可視化)
 *
 * 方針:
 *   - 戦闘領域は Canvas。画像は assets/prototype/** から読み、未生成なら
 *     手続きフォールバック描画 (同一アンカー契約) で表示する。
 *   - 命中・HP減・反動・音はコアのイベント到着フレームで同時に出す (±50ms)。
 *   - UI は下部 (呼び鈴・名簿・強化) と上部の簡易HUDのみ。モーダルは
 *     全面を覆わないボトムシート。
 * ========================================================================= */
(function () {
  'use strict';

  const DATA = window.GAME_DATA;
  const { ASSETS, CATS, HELPERS, ENEMIES, SHOPS, RELICS, FLOORS, BALANCE } = DATA;
  const game = new window.GAME_CORE.Game();
  window.__game = game; // 検証用

  const W = BALANCE.world;
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================================
   * アセットローダ (画像が後から追加されれば自動で使われる)
   * =================================================================== */
  const Images = { ready: {}, failed: {} };
  function loadAssets() {
    const all = [];
    ['cats', 'enemies', 'bg', 'shops'].forEach(group => {
      Object.keys(ASSETS[group]).forEach(id => {
        const meta = ASSETS[group][id];
        all.push(new Promise(resolve => {
          const img = new Image();
          img.onload = () => { Images.ready[group + '.' + id] = img; resolve(); };
          img.onerror = () => { Images.failed[group + '.' + id] = true; resolve(); };
          img.src = meta.src;
        }));
      });
    });
    return Promise.all(all);
  }
  function getImg(group, id) { return Images.ready[group + '.' + id] || null; }

  /* =====================================================================
   * WebAudio 簡易音 (視覚イベントと同フレームで鳴らし ±50ms を守る)
   * =================================================================== */
  const Audio2 = {
    ctx: null, master: null, muted: localStorage.getItem('ct_mute') === '1',
    init() {
      if (this.ctx) return;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { /* 音なしでも成立 */ }
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    setMuted(m) {
      this.muted = m;
      localStorage.setItem('ct_mute', m ? '1' : '0');
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
    },
    _osc(type, freq, t0, dur, vol, slideTo) {
      if (!this.ctx || this.muted) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    _noise(t0, dur, vol, freq) {
      if (!this.ctx || this.muted) return;
      const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 1200;
      const g = this.ctx.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t0);
    },
    now() { return this.ctx ? this.ctx.currentTime : 0; },
    bell()    { const t = this.now(); this._osc('sine', 1320, t, 0.18, 0.5); this._osc('sine', 1980, t + 0.07, 0.22, 0.35); },
    denied()  { const t = this.now(); this._osc('square', 220, t, 0.09, 0.2); },
    spawn()   { this._noise(this.now(), 0.16, 0.3, 900); },
    melee()   { const t = this.now(); this._noise(t, 0.07, 0.5, 1600); this._osc('sine', 140, t, 0.09, 0.5, 70); },
    fire()    { const t = this.now(); this._osc('triangle', 880, t, 0.08, 0.25, 440); },
    impact()  { const t = this.now(); this._noise(t, 0.06, 0.4, 2000); this._osc('sine', 220, t, 0.07, 0.3, 110); },
    hurt()    { const t = this.now(); this._osc('square', 180, t, 0.1, 0.25, 120); },
    ko()      { const t = this.now(); this._osc('sawtooth', 520, t, 0.22, 0.3, 90); this._noise(t + 0.04, 0.18, 0.35, 700); },
    coin()    { const t = this.now(); this._osc('sine', 988, t, 0.07, 0.3); this._osc('sine', 1319, t + 0.06, 0.12, 0.3); },
    heal()    { const t = this.now(); this._osc('sine', 660, t, 0.12, 0.2); this._osc('sine', 880, t + 0.08, 0.14, 0.2); },
    delivery(){ const t = this.now(); this._osc('sine', 784, t, 0.12, 0.3); this._osc('sine', 1047, t + 0.09, 0.18, 0.3); },
    stairs()  { const t = this.now(); [0, 0.12, 0.24].forEach((d, i) => this._osc('triangle', 300 + i * 90, t + d, 0.07, 0.25)); },
    clear()   { const t = this.now(); [523, 659, 784, 1047].forEach((f, i) => this._osc('triangle', f, t + i * 0.11, 0.22, 0.35)); },
    boss()    { const t = this.now(); this._osc('sawtooth', 90, t, 0.5, 0.4, 55); this._noise(t, 0.4, 0.3, 300); },
    phase()   { const t = this.now(); this._osc('sawtooth', 200, t, 0.35, 0.35, 400); this._noise(t + 0.1, 0.3, 0.3, 500); },
    defeat()  { const t = this.now(); [392, 330, 262, 196].forEach((f, i) => this._osc('triangle', f, t + i * 0.16, 0.24, 0.3)); },
    unlock()  { const t = this.now(); [784, 988, 1175, 1568].forEach((f, i) => this._osc('sine', f, t + i * 0.09, 0.2, 0.3)); },
    ui()      { const t = this.now(); this._osc('sine', 700, t, 0.05, 0.15); },
    rally()   { const t = this.now(); [660, 660, 880].forEach((f, i) => this._osc('square', f, t + i * 0.08, 0.09, 0.18)); }
  };

  /* =====================================================================
   * Canvas セットアップ
   * =================================================================== */
  const canvas = document.getElementById('battle');
  const ctx = canvas.getContext('2d');
  let view = { w: 390, h: 470, scale: 1, dpr: 1 };
  function groundY() { return view.h * 0.80; }

  function resize() {
    const wrap = document.getElementById('battle-wrap');
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (!cw || !ch) return;
    view.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * view.dpr);
    canvas.height = Math.round(ch * view.dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    view.scale = cw / W.width;      // 論理幅390pxに合わせる
    view.w = W.width;
    view.h = ch / view.scale;
  }
  window.addEventListener('resize', resize);

  /* =====================================================================
   * エフェクト状態 (描画専用)
   * =================================================================== */
  const fx = {
    dmg: [],        // ダメージ数字 {x,y,txt,color,t,strong}
    parts: [],      // 汎用パーティクル
    coins: [],      // コイン飛行
    lunge: {},      // uid -> t (攻撃の踏み込み)
    shake: 0,
    bannerT: 0,
    warmT: 0,       // 制圧後の暖色転調
    sealT: 0,       // 入口封鎖チェーン表示
    smokeRing: [],  // 煙輪
    floorIntroT: 0
  };

  function addDamageNum(x, y, txt, color, strong) {
    fx.dmg.push({ x, y, txt, color, t: 0, strong: !!strong });
  }
  function burst(x, y, n, color, speed, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (speed || 60) * (0.4 + Math.random() * 0.8);
      fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, life: life || 0.5, color, size: 2 + Math.random() * 3 });
    }
  }
  function puffSand(x) {
    for (let i = 0; i < 10; i++) {
      fx.parts.push({ x: x + (Math.random() - 0.5) * 16, y: groundY() - 2, vx: (Math.random() - 0.5) * 50, vy: -20 - Math.random() * 40, t: 0, life: 0.45, color: 'rgba(190,175,150,0.8)', size: 3 + Math.random() * 4 });
    }
  }

  /* =====================================================================
   * 描画: 背景
   * =================================================================== */
  function drawBackground() {
    const H = view.h, gy = groundY();
    const conquered = game.mode === 'conquest' || game.mode === 'choice' || fx.warmT > 0;
    const bgMeta = conquered ? ASSETS.bg.floor_living : ASSETS.bg.floor_ruined;
    const img = getImg('bg', conquered ? 'floor_living' : 'floor_ruined');
    if (img) {
      // 2:3 or 1:1 をカバーで描画
      const s = Math.max(view.w / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (view.w - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const fb = bgMeta.fallback;
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, fb.top); grd.addColorStop(1, fb.bottom);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, view.w, H);
      // 廃墟の柱とひび (フォールバックの簡易背景)
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 4; i++) ctx.fillRect(30 + i * 110, H * 0.08, 26, gy - H * 0.08);
      if (conquered) {
        // 暖色の灯り
        const warm = ctx.createRadialGradient(view.w / 2, H * 0.25, 20, view.w / 2, H * 0.25, 260);
        warm.addColorStop(0, 'rgba(255,190,90,0.28)'); warm.addColorStop(1, 'rgba(255,190,90,0)');
        ctx.fillStyle = warm; ctx.fillRect(0, 0, view.w, H);
      }
    }
    // 床 (不透明: 背景画像下端の透かしも隠す)
    const g2 = ctx.createLinearGradient(0, gy, 0, H);
    if (conquered) { g2.addColorStop(0, '#5a4832'); g2.addColorStop(1, '#3a2d1e'); }
    else { g2.addColorStop(0, '#3c3e48'); g2.addColorStop(1, '#26242e'); }
    ctx.fillStyle = g2;
    ctx.fillRect(0, gy, view.w, H - gy);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, gy, view.w, 2);
    // レーンガイド (ごく薄く)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    W.laneY.forEach(dy => {
      ctx.beginPath(); ctx.moveTo(0, gy + dy + 1); ctx.lineTo(view.w, gy + dy + 1); ctx.stroke();
    });
    // 入口 (左) と 敵の入口 (右)
    drawEntrance(0, gy, 'left');
    drawEntrance(view.w, gy, 'right');
    // 階段 (制圧〜登階で使用)
    if (game.mode === 'conquest' || game.conquestPhase === 'climb') drawStairs(gy);
    // 8F 封鎖門
    if (game.floor === 8 && game.mode === 'battle') drawGate(gy);
    // 5F トト (救出対象)
    if (game.floor === 5 && !game.unlocked.toto) drawTotoNpc(gy);
  }

  function drawEntrance(x, gy, side) {
    ctx.save();
    ctx.translate(x, gy);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    if (side === 'left') ctx.rect(0, -64, 22, 64); else ctx.rect(-22, -64, 22, 64);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.stroke();
    ctx.restore();
  }

  function drawStairs(gy) {
    ctx.save();
    ctx.fillStyle = 'rgba(120,100,80,0.9)';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(W.stairsX + i * 10, gy - (i + 1) * 11, 12, 11);
    }
    ctx.restore();
  }

  function drawGate(gy) {
    // 封鎖門: 補充状態を常時表示する壁 (§7.3)
    const gx = W.enemyEntryX + 6;
    ctx.save();
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(gx - 8, gy - 96, 20, 96);
    ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 2;
    ctx.strokeRect(gx - 8, gy - 96, 20, 96);
    ctx.fillStyle = '#8a2a22';
    for (let i = 0; i < 3; i++) ctx.fillRect(gx - 6, gy - 88 + i * 30, 16, 6);
    const owl = game.enemies.find(e => !e.dead && e.tag === 'ledger');
    ctx.fillStyle = owl ? '#ffd25a' : '#777';
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(owl ? '補充中' : '停止', gx + 2, gy - 102);
    ctx.restore();
  }

  function drawTotoNpc(gy) {
    // 救出前のトト: 右奥の壊れた診療台のそば
    const x = 300, y = gy + W.laneY[2];
    ctx.save();
    ctx.globalAlpha = 0.95;
    drawCatShape(x, y, 0.82, ASSETS.cats.toto.fallback, 0, false, 0);
    // 檻ではなく残敵と安全状態表示 (§4.3)
    ctx.fillStyle = game.totoDanger ? '#e04a3a' : '#8fd6a0';
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(game.totoDanger ? '危険!' : 'トトを守れ', x, y - 72);
    ctx.restore();
  }

  /* =====================================================================
   * 描画: ユニット (画像があればアンカー契約で、なければフォールバック)
   * =================================================================== */
  function unitScreenPos(u) {
    // レーン縦オフセット + 登階中の上昇 + 飛行高度
    let x = u.x;
    let y = groundY() + W.laneY[u.lane || 0];
    if (u.side === 'enemy') x += u.kb || 0; else x -= u.kb || 0;
    const lunge = fx.lunge[u.uid] || 0;
    if (lunge > 0) x += (u.side === 'cat' ? 1 : -1) * lunge * 26;
    if (u.state === 'climb') {
      // 階段を実際に登る (背景だけ動かす疑似上昇にしない)
      const p = Math.min(1, u.stateT / 0.8);
      y -= p * 66;
      x += p * 30;
    }
    return { x, y };
  }

  function drawUnits(t) {
    const all = game.cats.concat(game.enemies);
    all.sort((a, b) => (W.laneY[a.lane || 0]) - (W.laneY[b.lane || 0]));
    for (const u of all) {
      if (u.dead && !u.named) continue;
      drawUnit(u, t);
    }
    // 弾
    for (const p of game.projectiles) drawProjectile(p);
  }

  function drawUnit(u, t) {
    const group = u.side === 'cat' ? 'cats' : 'enemies';
    const meta = ASSETS[group][u.defId];
    const laneScale = W.laneScale[u.lane || 0];
    const pos = unitScreenPos(u);
    const moving = (u.state === 'enter' || u.state === 'toStairs' || u.state === 'climb' ||
      (u.state === 'combat' && isAdvancing(u)));
    const windupP = u.state === 'windup' ? Math.min(1, u.stateT / (u.windup || 0.3)) : 0;

    // 高度 (飛行敵): 本体を浮かせ、影は床に残す (§14.3)
    let flyH = 0;
    if (u.flying) {
      const target = u.swooping ? 18 : (u.altitude || 90);
      flyH = target + Math.sin(t * 3 + u.uid) * 4;
    }

    // 影 (床、足裏基準)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    const shW = 26 * laneScale * (1 - Math.min(0.5, flyH / 220));
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 2, shW, shW * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const drawY = pos.y - flyH;
    const img = getImg(group, u.defId);
    const sm = img ? spriteMetrics(img, meta, laneScale) : null;
    ctx.save();
    ctx.translate(pos.x, drawY);
    if (u.side === 'enemy' && !img) ctx.scale(-1, 1); // フォールバックのみ右向きに描いて反転 (実素材の敵は左向き)
    if (windupP > 0) { ctx.rotate(-windupP * 0.14); ctx.scale(1 + windupP * 0.06, 1 - windupP * 0.05); }
    if (u.state === 'faint') ctx.rotate(-Math.PI / 2 * 0.9);
    const bob = moving ? Math.abs(Math.sin(t * 10 + u.uid)) * 3 : Math.sin(t * 2 + u.uid) * 1.2;
    ctx.translate(0, -bob);

    if (img) {
      // footAnchor を足裏(0,0)に合わせ、visibleBounds 分を表示高さへ (§7.1/§7.2)
      ctx.drawImage(img, sm.dx, sm.dy, sm.w, sm.h);
    } else {
      drawFallback(u, meta, laneScale, t, moving, flyH);
    }
    ctx.restore();

    // 命中フラッシュ (白抜き)
    if (u.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, u.flash / 0.12) * 0.75;
      ctx.translate(pos.x, drawY - 26 * laneScale);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(0, 0, 22 * laneScale, 26 * laneScale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 強攻撃の予告 (姿勢+色+アイコン, §6.3)
    const spriteTop = sm ? sm.topY : -meta.displayHeight * laneScale;
    if (u.telegraph && u.state === 'windup') {
      ctx.save();
      ctx.translate(pos.x, drawY + spriteTop - 14);
      ctx.fillStyle = '#e04a3a';
      ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('!', 0, 0);
      ctx.strokeStyle = 'rgba(224,74,58,0.8)';
      ctx.beginPath(); ctx.arc(0, -6, 12 + Math.sin(t * 12) * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      if (u.boss || (u.pushback && u.pushback.every)) {
        // 床の赤線/扇形
        ctx.save();
        ctx.fillStyle = 'rgba(224,74,58,0.18)';
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.arc(pos.x, pos.y, 90, Math.PI * 0.75, Math.PI * 1.25);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    drawHpBar(u, pos, drawY, spriteTop);
  }

  // visibleBounds と footAnchor から、表示高さ displayHeight になる
  // 全体画像の描画矩形と可視上端オフセットを計算 (§7.1 座標契約)
  function spriteMetrics(img, meta, laneScale) {
    const vb = meta.visibleBounds || [0, 0, 1, 1];
    const visH = Math.max(0.05, vb[3]); // visibleBounds は [x, y, w, h] 形式 (anchors.json 契約)
    const drawH = meta.displayHeight * laneScale;
    const h = drawH / visH;                       // 画像全体の描画高さ
    const w = h * (img.width / img.height);
    return {
      w, h,
      dx: -w * meta.footAnchor.x,
      dy: -h * meta.footAnchor.y,
      topY: -h * (meta.footAnchor.y - vb[1])      // 足裏から可視上端まで (負)
    };
  }

  function isAdvancing(u) {
    if (u.side === 'cat') {
      const tgt = game.enemies.find(e => e.uid === u.targetUid);
      return tgt && !tgt.dead && (tgt.x - u.x) > u.range + 14;
    }
    const tgt = game.cats.find(c => c.uid === u.targetUid);
    return !tgt || (u.x - (tgt ? tgt.x : 0)) > u.range + 14;
  }

  function drawHpBar(u, pos, drawY, spriteTop) {
    if (u.dead) return;
    const w = u.boss ? 90 : 40;
    const x = pos.x - w / 2, y = drawY + spriteTop - 8;
    // 名前付き猫は名前チップ
    ctx.save();
    if (u.named || u.boss) {
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = u.side === 'cat' ? '#ffe9b0' : '#ffb0a0';
      ctx.fillText(u.name, pos.x, y - 3);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    const r = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = u.side === 'cat' ? (r > 0.4 ? '#6fd66f' : '#e0a03a') : (u.boss ? '#c04ae0' : '#e05a4a');
    ctx.fillRect(x, y, w * r, 4);
    ctx.restore();
  }

  /* ---------- フォールバック描画 (ピクセルアート調の簡易シルエット) ---------- */
  function drawFallback(u, meta, s, t, moving, flyH) {
    const fb = meta.fallback;
    const legPhase = moving ? t * 14 : 0;
    if (u.side === 'cat') drawCatShape(0, 0, s, fb, legPhase, true, u.defId, u);
    else drawEnemyShape(0, 0, s, fb, legPhase, u.defId, t, u);
  }

  // 猫の共通シルエット。足元が (0,0)。右向き。
  function drawCatShape(x, y, s, fb, legPhase, props, defId, u) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    const lean = defId === 'kohaku' || defId === 'runner' ? 0.16 : 0;
    ctx.rotate(lean * 0.4);
    const c = fb.tint, a = fb.accent;
    // 脚 (歩行サイクル)
    ctx.strokeStyle = shade(c, -30); ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const bx = -12 + i * 7, sw = Math.sin(legPhase + i * 1.7) * 5;
      ctx.beginPath(); ctx.moveTo(bx, -12); ctx.lineTo(bx + sw, 0); ctx.stroke();
    }
    // しっぽ
    ctx.strokeStyle = c; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-16, -22);
    ctx.quadraticCurveTo(-28, -30 + Math.sin(legPhase * 0.5) * 4, -30, -40);
    ctx.stroke();
    // 体
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(-2, -20, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
    // 頭
    ctx.beginPath(); ctx.arc(13, -32, 10, 0, Math.PI * 2); ctx.fill();
    // 耳
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(7, -40); ctx.lineTo(9, -48); ctx.lineTo(13, -41); ctx.fill();
    ctx.beginPath(); ctx.moveTo(15, -41); ctx.lineTo(19, -48); ctx.lineTo(21, -40); ctx.fill();
    // 目
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(17, -33, 1.6, 0, Math.PI * 2); ctx.fill();
    // 頬
    ctx.fillStyle = shade(c, 25);
    ctx.beginPath(); ctx.arc(19, -29, 2, 0, Math.PI * 2); ctx.fill();

    if (props) {
      ctx.fillStyle = a;
      switch (defId) {
        case 'mugi': // 木盾
          ctx.fillStyle = '#a8763e';
          roundRect(18, -26, 9, 16, 3); ctx.fill();
          ctx.strokeStyle = '#6a4a22'; ctx.lineWidth = 1.5; ctx.stroke();
          break;
        case 'guard': // 丸盾
          ctx.fillStyle = '#7a8a9e';
          ctx.beginPath(); ctx.arc(22, -18, 9, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#3f4c60'; ctx.lineWidth = 2; ctx.stroke();
          break;
        case 'luna': // 短弓
          ctx.strokeStyle = a; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(22, -28, 10, -1.2, 1.2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(22 + Math.cos(-1.2) * 10, -28 + Math.sin(-1.2) * 10);
          ctx.lineTo(22 + Math.cos(1.2) * 10, -28 + Math.sin(1.2) * 10); ctx.stroke();
          break;
        case 'slinger': // 投石器を頭上で回す
          ctx.strokeStyle = a; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(13, -42); ctx.lineTo(24, -52); ctx.stroke();
          ctx.fillStyle = a;
          ctx.beginPath(); ctx.arc(26, -54, 3, 0, Math.PI * 2); ctx.fill();
          break;
        case 'toto': // 包帯バッグ
          ctx.fillStyle = '#fff';
          roundRect(2, -30, 10, 8, 2); ctx.fill();
          ctx.fillStyle = '#d05a5a';
          ctx.fillRect(5, -29, 4, 6); ctx.fillRect(3.5, -27.5, 7, 3);
          break;
        case 'kohaku': // 配送鞄
          ctx.fillStyle = '#8a5a2a';
          roundRect(-14, -34, 10, 9, 2); ctx.fill();
          ctx.strokeStyle = '#5a3a16'; ctx.lineWidth = 1.5; ctx.stroke();
          break;
        case 'runner': // 前傾+鞄
          ctx.fillStyle = '#a8763e';
          roundRect(-13, -32, 9, 8, 2); ctx.fill();
          break;
      }
      if (u && u.shieldUp) { // ムギの盾構え
        ctx.strokeStyle = 'rgba(120,200,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(24, -18, 13, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 敵のシルエット。足元が (0,0)。描画側で左右反転済み (右向きに描く)。
  function drawEnemyShape(x, y, s, fb, legPhase, defId, t, u) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    const c = fb.tint, a = fb.accent;
    const run = Math.abs(legPhase) > 0;
    switch (defId) {
      case 'ash_mouse': {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(0, -10, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(11, -16, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(9, -22, 3.4, 0, Math.PI * 2); ctx.fill(); // 耳
        ctx.strokeStyle = '#caa'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-13, -10); ctx.quadraticCurveTo(-22, -14 + Math.sin(t * 4) * 3, -26, -8); ctx.stroke();
        ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.arc(13, -17, 1.5, 0, Math.PI * 2); ctx.fill();
        legs(2, 6, legPhase);
        break;
      }
      case 'soot_weasel': {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(-2, -9, 18, 6.5, 0, 0, Math.PI * 2); ctx.fill(); // 低く長い
        ctx.beginPath(); ctx.arc(15, -12, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(16.5, -13, 1.2, 0, Math.PI * 2); ctx.fill();
        if (run) { // 白い速度線 (予告 §6.2)
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(-20 - i * 6, -14 + i * 4); ctx.lineTo(-30 - i * 6, -14 + i * 4); ctx.stroke();
          }
        }
        legs(2, 5, legPhase);
        break;
      }
      case 'sack_mole': {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(-4, -13, 13, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(5, -22, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8b8c8'; ctx.beginPath(); ctx.ellipse(10, -20, 3, 2, 0, 0, Math.PI * 2); ctx.fill(); // 鼻
        // 袋盾 (正面に立てる)
        const broken = u && u.shieldBroken > 0;
        ctx.fillStyle = broken ? 'rgba(138,122,90,0.45)' : a;
        ctx.beginPath(); ctx.ellipse(16, -14, 8, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#5a4a34'; ctx.lineWidth = 2; ctx.stroke();
        legs(2, 6, legPhase);
        break;
      }
      case 'scrap_crow': {
        const flap = Math.sin(t * 10 + (u ? u.uid : 0)) * 0.5;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(0, -16, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(10, -22, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = a; // 光る金属片のくちばし
        ctx.beginPath(); ctx.moveTo(15, -22); ctx.lineTo(22, -20); ctx.lineTo(15, -19); ctx.fill();
        ctx.fillStyle = c; // 翼
        ctx.save(); ctx.rotate(flap * 0.6);
        ctx.beginPath(); ctx.ellipse(-4, -24, 12, 4.5, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.arc(11, -23, 1.4, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'smoke_bat': {
        const flap = Math.sin(t * 12 + (u ? u.uid : 0));
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(0, -18, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -22, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c; // 翼
        [-1, 1].forEach(d => {
          ctx.save(); ctx.translate(-2, -20); ctx.rotate(d * flap * 0.5);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-14 * d, -6); ctx.lineTo(-12 * d, 4); ctx.closePath(); ctx.fill();
          ctx.restore();
        });
        ctx.fillStyle = a; ctx.beginPath(); ctx.arc(7.5, -23, 1.3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'spark_gecko': {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(-2, -8, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(11, -11, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = c; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-15, -8); ctx.quadraticCurveTo(-24, -6, -26, -12); ctx.stroke();
        // 背中の火花3回点滅 (予告 §6.6)
        const blink = Math.floor(t * 3) % 3;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i <= blink ? '#ffd25a' : 'rgba(255,210,90,0.25)';
          ctx.beginPath(); ctx.arc(-8 + i * 6, -14, 2, 0, Math.PI * 2); ctx.fill();
        }
        legs(4, 4, legPhase);
        break;
      }
      case 'ledger_owl': {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(0, -22, 14, 17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(2, -40, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-1, -41, 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -41, 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(-1, -41, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -41, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = a; // 帳簿
        ctx.save(); ctx.translate(12, -20); ctx.rotate(-0.3);
        ctx.fillRect(0, -7, 12, 14);
        ctx.strokeStyle = '#8a7a4a'; ctx.lineWidth = 1; ctx.strokeRect(0, -7, 12, 14);
        if (u && u.summonT > 6) { // ページをめくる予告
          ctx.strokeStyle = '#fff';
          ctx.beginPath(); ctx.moveTo(3, -5); ctx.quadraticCurveTo(10, -12 + Math.sin(t * 8) * 3, 11, -5); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'blackwing_guard': {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(-2, -26, 15, 20, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(4, -48, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = a; // 赤い羽飾り
        ctx.beginPath(); ctx.moveTo(0, -55); ctx.lineTo(4, -66); ctx.lineTo(9, -55); ctx.fill();
        // 大盾
        ctx.fillStyle = '#3a4050';
        roundRect(12, -44, 12, 38, 5); ctx.fill();
        ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(18, -26, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff6a5a'; ctx.beginPath(); ctx.arc(7, -49, 1.6, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'kagetsubasa': {
        const phase = u && u.boss ? u.boss.phase : 0;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(-2, -34, 22, 26, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(10, -62, 13, 0, Math.PI * 2); ctx.fill();
        // 大鎌
        ctx.strokeStyle = '#8a8f9e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(18, -10); ctx.lineTo(26, -58); ctx.stroke();
        ctx.strokeStyle = '#d0d5e2';
        ctx.beginPath(); ctx.arc(20, -58, 14, -0.4, 1.4); ctx.stroke();
        // 目
        ctx.fillStyle = '#e04a3a';
        ctx.beginPath(); ctx.arc(8, -64, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(15, -64, 2.4, 0, Math.PI * 2); ctx.fill();
        // 形態ごとのオーラ
        if (phase === 1) { // 黒羽旋回
          const flap = Math.sin(t * 8) * 0.4;
          ctx.fillStyle = 'rgba(20,22,30,0.95)';
          [-1, 1].forEach(d => {
            ctx.save(); ctx.translate(-4, -50); ctx.rotate(d * (0.7 + flap));
            ctx.beginPath(); ctx.ellipse(-16 * d, 0, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          });
        } else if (phase === 2) { // 封鎖命令
          ctx.strokeStyle = 'rgba(224,74,58,0.7)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, -36, 34 + Math.sin(t * 5) * 3, 0, Math.PI * 2); ctx.stroke();
        }
        // 帳簿印のマント
        ctx.fillStyle = 'rgba(90,40,90,0.85)';
        ctx.beginPath(); ctx.moveTo(-14, -50); ctx.lineTo(-24, -8); ctx.lineTo(-8, -14); ctx.closePath(); ctx.fill();
        break;
      }
    }
    ctx.restore();

    function legs(n, h, ph) {
      ctx.strokeStyle = shade(c, -25); ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const bx = -6 + i * 8, sw = Math.sin(ph + i * 2.1) * 4;
        ctx.beginPath(); ctx.moveTo(bx, -h); ctx.lineTo(bx + sw, 0); ctx.stroke();
      }
    }
  }

  function drawProjectile(p) {
    const x = p.x0 + (p.x1 - p.x0) * p.t;
    const baseY = groundY() + W.laneY[1] - 34;
    const y = baseY - Math.sin(p.t * Math.PI) * p.arc;
    ctx.save();
    if (p.kind === 'bandage') {
      ctx.fillStyle = '#fff';
      roundRect(x - 5, y - 4, 10, 8, 2); ctx.fill();
      ctx.fillStyle = '#d05a5a'; ctx.fillRect(x - 1.5, y - 3, 3, 6); ctx.fillRect(x - 3.5, y - 1.5, 7, 3);
    } else if (p.kind === 'scrap') {
      ctx.fillStyle = '#c8b04a';
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.t * 12);
      ctx.fillRect(-4, -3, 8, 6); ctx.restore();
    } else if (p.kind === 'smoke') {
      ctx.fillStyle = 'rgba(120,110,140,0.8)';
      ctx.beginPath(); ctx.arc(x, y, 6 + p.t * 4, 0, Math.PI * 2); ctx.fill();
    } else { // stone
      ctx.fillStyle = '#cbb';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- ユーティリティ ---------- */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* =====================================================================
   * 描画: エフェクト (数字・粒子・コイン・バナー)
   * =================================================================== */
  function drawFx(dt) {
    // パーティクル
    for (let i = fx.parts.length - 1; i >= 0; i--) {
      const p = fx.parts[i];
      p.t += dt;
      if (p.t >= p.life) { fx.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 煙輪 (煙コウモリの照準乱れ)
    for (let i = fx.smokeRing.length - 1; i >= 0; i--) {
      const s = fx.smokeRing[i];
      s.t += dt;
      if (s.t > 1) { fx.smokeRing.splice(i, 1); continue; }
      ctx.strokeStyle = 'rgba(150,140,170,' + (0.6 * (1 - s.t)) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.x, s.y, 8 + s.t * 40, 0, Math.PI * 2); ctx.stroke();
    }
    // ダメージ数字
    ctx.textAlign = 'center';
    for (let i = fx.dmg.length - 1; i >= 0; i--) {
      const d = fx.dmg[i];
      d.t += dt;
      if (d.t > 0.9) { fx.dmg.splice(i, 1); continue; }
      const p = d.t / 0.9;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = (d.strong ? 'bold 20px' : 'bold 14px') + ' sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
      const y = d.y - 20 - p * 34;
      ctx.strokeText(d.txt, d.x, y);
      ctx.fillStyle = d.color;
      ctx.fillText(d.txt, d.x, y);
    }
    ctx.globalAlpha = 1;
    // コイン飛行 (撃破→猫側へ → HUD)
    const coinTarget = hudCoinPos();
    for (let i = fx.coins.length - 1; i >= 0; i--) {
      const c = fx.coins[i];
      c.t += dt * 1.6;
      if (c.t >= 1) { fx.coins.splice(i, 1); bumpCoinHud(); continue; }
      const e = 1 - Math.pow(1 - c.t, 2);
      const x = c.x0 + (coinTarget.x - c.x0) * e;
      const y = c.y0 + (coinTarget.y - c.y0) * e - Math.sin(c.t * Math.PI) * 30;
      ctx.fillStyle = '#ffd25a';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a8761a';
      ctx.font = 'bold 7px sans-serif';
      ctx.fillText('¢', x, y + 2.5);
    }
  }

  function hudCoinPos() {
    const el = document.getElementById('hud-coins');
    const r = el.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - cr.left) / view.scale, y: (r.top + r.height / 2 - cr.top) / view.scale };
  }

  /* =====================================================================
   * コアイベント → 音・エフェクト (同フレーム処理で±50ms同期)
   * =================================================================== */
  function processEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'bell-ring': Audio2.bell(); puffSand(W.entryX); break;
        case 'bell-denied': Audio2.denied(); setBellLabel(ev.reason || '出撃できない'); break;
        case 'rally': Audio2.rally(); showBanner('号令! 全員加速', 1.2); break;
        case 'helper-spawn': Audio2.spawn(); puffSand(W.entryX); break;
        case 'enemy-spawn': puffSand(W.enemyEntryX); break;
        case 'telegraph': if (ev.boss) Audio2.boss(); break;
        case 'projectile-fire': Audio2.fire(); fx.lunge[ev.srcUid] = 0.12; break;
        case 'hit': {
          // 命中・HP減・反動・音・ヒットストップを同時に
          const u = findUnit(ev.uid);
          const y = unitScreenPos(u || { x: ev.x, lane: 1, kb: 0 }).y - 40;
          if (ev.shielded) addDamageNum(ev.x, y, String(ev.dmg), '#9ab', ev.strong);
          else addDamageNum(ev.x, y, String(ev.dmg), ev.strong ? '#ffb02a' : '#fff', ev.strong);
          if (ev.melee) { Audio2.melee(); fx.lunge[ev.srcUid || 0] = 0.1; }
          else Audio2.impact();
          burst(ev.x, y + 10, ev.strong ? 10 : 5, ev.strong ? '#ffb02a' : '#ffe9b0', 80, 0.4);
          if (!REDUCED) fx.shake = Math.max(fx.shake, ev.strong ? BALANCE.combat.shakeStrong : BALANCE.combat.shakeWeak);
          break;
        }
        case 'miss': addDamageNum(ev.x || 200, groundY() - 60, 'ミス', '#ccc'); break;
        case 'heal-hit': {
          const u = findUnit(ev.uid);
          if (u) addDamageNum(u.x, unitScreenPos(u).y - 44, '+' + ev.amount, '#7fe07f');
          Audio2.heal();
          break;
        }
        case 'ko': {
          Audio2.ko();
          burst(ev.x, groundY() - 20, 16, '#c9c2b8', 110, 0.6);
          for (let i = 0; i < 3; i++) fx.coins.push({ x0: ev.x, y0: groundY() - 30, t: -i * 0.08 });
          if (ev.boss) showBanner('カゲツバサを退けた!', 2);
          break;
        }
        case 'cat-hit': Audio2.hurt(); break;
        case 'cat-faint': showBanner(catName(ev.defId) + 'が気絶…', 1.4); break;
        case 'cat-revive': showBanner(catName(ev.defId) + 'が復帰!', 1.2); break;
        case 'helper-down': burst(W.entryX + 30, groundY() - 20, 8, '#aab', 70, 0.5); break;
        case 'shield-stance': Audio2.ui(); break;
        case 'shield-block': addDamageNum(findUnit(ev.uid).x, groundY() - 60, '盾軽減!', '#8fd0ff'); break;
        case 'shield-break': { const u = findUnit(ev.uid); if (u) { addDamageNum(u.x, unitScreenPos(u).y - 56, '破砕!', '#ffd25a'); Audio2.impact(); } break; }
        case 'interrupt': { const u = findUnit(ev.targetUid); if (u) addDamageNum(u.x, unitScreenPos(u).y - 56, '詠唱停止!', '#8fd0ff'); break; }
        case 'enemy-buff': { const u = findUnit(ev.targetUid); if (u) addDamageNum(u.x, unitScreenPos(u).y - 60, '強化', '#ff8a5a'); break; }
        case 'enemy-summon': showBanner('帳簿係が補充を呼んだ!', 1.4); Audio2.boss(); break;
        case 'smoke': fx.smokeRing.push({ x: findUnit(ev.uid) ? findUnit(ev.uid).x : 200, y: groundY() - 40, t: 0 }); break;
        case 'pushback': if (!REDUCED) fx.shake = Math.max(fx.shake, 6); break;
        case 'entry-seal': fx.sealT = ev.duration; showBanner('入口が封鎖された! 帳簿係を止めろ', 1.8); Audio2.boss(); break;
        case 'delivery-depart': break; // 塔ビューで箱が動く
        case 'delivery-arrive': {
          Audio2.delivery();
          showBanner(ev.icon + ' ' + ev.item + 'が到着!', 1.4);
          burst(W.entryX + 20, groundY() - 40, 12, '#ffd25a', 90, 0.6);
          break;
        }
        case 'delivery-stolen': showBanner('配送箱を没収された…', 1.5); break;
        case 'luna-progress': showBanner('補給箱 ' + ev.n + '/' + ev.need, 1.2); break;
        case 'luna-snipe': { const u = findUnit(ev.uid); if (u) burst(u.x, groundY() - 60, 20, '#b9c7f2', 130, 0.7); Audio2.impact(); showBanner('ルナの狙撃!', 1.4); break; }
        case 'unlock-cat': onUnlockCat(ev); break;
        case 'ledger-first': showBanner('帳簿係を先に倒した! 補充が止まる', 1.8); break;
        case 'kohaku-progress': break;
        case 'wave-clear': showBanner('WAVEクリア', 1.0); break;
        case 'wave-start': showBanner('WAVE ' + ev.wave + ' / ' + ev.total, 1.4); Audio2.ui(); break;
        case 'toto-waveheal': showBanner('トトの全体回復', 1.2); Audio2.heal(); break;
        case 'floor-clear': {
          Audio2.clear();
          showBanner('制圧!', 1.6, true);
          fx.warmT = 3;
          for (let i = 0; i < 5; i++) fx.coins.push({ x0: 200 + i * 10, y0: groundY() - 60, t: -0.4 - i * 0.1 });
          break;
        }
        case 'conquest-phase': if (ev.phase === 'climb') Audio2.stairs(); break;
        case 'floor-enter': onFloorEnter(ev); break;
        case 'shop-choice': openShopChoice(ev.floor, ev.candidates); break;
        case 'relic-choice': openRelicChoice(); break;
        case 'shop-placed': Audio2.clear(); break;
        case 'relic-chosen': Audio2.unlock(); break;
        case 'boss-phase': {
          Audio2.phase();
          showBanner(ev.def.name, 2.2, true);
          if (!REDUCED) fx.shake = 8;
          break;
        }
        case 'defeat': onDefeat(ev); break;
        case 'district-clear': onDistrictClear(); break;
        case 'upgrade': Audio2.coin(); break;
      }
    }
    updateHud();
  }

  function findUnit(uid) {
    return game.cats.find(u => u.uid === uid) || game.enemies.find(u => u.uid === uid);
  }
  function catName(defId) { return (CATS[defId] || HELPERS[defId] || {}).name || defId; }

  /* =====================================================================
   * バナー (トースト文章のみの通知は禁止 → 常に演出とセットの短い大見出し)
   * =================================================================== */
  const bannerEl = document.getElementById('banner');
  let bannerTimer = null;
  function showBanner(text, dur, big) {
    bannerEl.textContent = text;
    bannerEl.classList.toggle('big', !!big);
    bannerEl.classList.add('show');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), (dur || 1.5) * 1000);
  }

  function onFloorEnter(ev) {
    const def = ev.def;
    showBanner(def.n + 'F ' + def.name, 2.0, true);
    setTimeout(() => { if (game.floor === def.n && def.intro) showBanner(def.intro, 2.6); }, 2100);
    fx.warmT = 0;
    document.getElementById('hud-floor').textContent = def.n + 'F ' + def.name;
  }

  /* =====================================================================
   * メインループ
   * =================================================================== */
  let lastT = 0;
  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016);
    lastT = ts;

    game.update(dt);
    processEvents(game.drainEvents());
    updateBellVisual();

    // lunge減衰
    Object.keys(fx.lunge).forEach(k => { fx.lunge[k] -= dt * 2; if (fx.lunge[k] <= 0) delete fx.lunge[k]; });
    if (fx.shake > 0) fx.shake = Math.max(0, fx.shake - dt * 20);
    if (fx.warmT > 0) fx.warmT -= dt;
    if (fx.sealT > 0) fx.sealT -= dt;

    render(ts / 1000, dt);
    requestAnimationFrame(loop);
  }

  function render(t, dt) {
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.save();
    if (fx.shake > 0 && !REDUCED) {
      ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
    }
    drawBackground();
    drawUnits(t);
    // 入口封鎖チェーン
    if (game.bellLockT > 0 || fx.sealT > 0) {
      ctx.strokeStyle = 'rgba(224,74,58,0.85)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, groundY() - 70); ctx.lineTo(34, groundY() - 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, groundY() - 10); ctx.lineTo(34, groundY() - 70); ctx.stroke();
    }
    drawFx(dt);
    ctx.restore();
    // 塔ビューが開いている間も配達箱の位置を更新
    if (towerOpen) renderTowerDeliveries();
  }

  /* =====================================================================
   * HUD / 下部UI
   * =================================================================== */
  const el = id => document.getElementById(id);
  const bellEl = el('bell'), bellLabelEl = el('bell-label'), slotsEl = el('helper-slots');

  function setBellLabel(text, sticky) {
    bellLabelEl.textContent = text || '';
    if (!sticky && text) {
      clearTimeout(setBellLabel._t);
      setBellLabel._t = setTimeout(() => { bellLabelEl.textContent = ''; }, 1600);
    }
  }

  function updateHud() {
    // コイン
    el('hud-coins').textContent = game.coins;
    // ウェーブ
    const def = game.floorDef();
    const waves = def.eliteChoice ? (game.hasShop('claw_forge') ? def.wavesAlt : def.waves) : def.waves;
    el('hud-wave').textContent = waves.length > 1 ? ('WAVE ' + (game.waveIdx + 1) + '/' + waves.length) : '';
    updateBellVisual();
    // 増援枠
    const helpers = game.cats.filter(c => !c.named && !c.dead).length;
    const max = game.helperSlotMax();
    slotsEl.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const s = document.createElement('span');
      s.className = 'slot' + (i < helpers ? ' filled' : '');
      s.textContent = '🐾';
      slotsEl.appendChild(s);
    }
    // 強化ボタン (最安のコストを表示)
    const costs = ['atk', 'hp', 'bell'].map(k => game.upgradeCost(k)).filter(c => c != null);
    el('btn-upgrade').querySelector('small').textContent = costs.length ? '〜' + Math.min(...costs) + '¢' : 'MAX';
    // 次の配送
    const next = game.deliveries.slice().sort((a, b) => a.arrive - b.arrive)[0];
    const dEl = el('hud-delivery');
    if (next) {
      const p = Math.min(1, (game.time - next.depart) / next.travel);
      dEl.style.display = '';
      dEl.querySelector('.dicon').textContent = SHOPS[next.shopId].deliveryIcon;
      dEl.querySelector('.dbar > i').style.width = (p * 100) + '%';
      dEl.title = SHOPS[next.shopId].deliveryItem + ' (出発: ' + next.fromFloor + 'F)';
    } else dEl.style.display = 'none';
    // 号令中
    el('hud-rally').style.display = game.rallyT > 0 ? '' : 'none';
  }

  // ベルの見た目だけは毎フレーム更新 (クールダウンを滑らかに)
  function updateBellVisual() {
    const st = game.bellState();
    bellEl.classList.toggle('locked', st === 'locked');
    const cd = game.bellCd > 0 ? game.bellCd / BALANCE.bell.cooldown : 0;
    bellEl.style.setProperty('--cd', (cd * 360) + 'deg');
    if (st === 'full') setBellLabel('満員 → 号令に変換', true);
    else if (st === 'locked') setBellLabel('入口封鎖中', true);
    else if (bellLabelEl.textContent === '満員 → 号令に変換' || bellLabelEl.textContent === '入口封鎖中') setBellLabel('');
  }

  function bumpCoinHud() {
    const c = el('hud-coins');
    c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  }

  /* ---------- 呼び鈴: 短押し1回=1要求、400ms長押しで連続呼び込み ---------- */
  (function setupBell() {
    let holdTimer = null, repeatTimer = null, startX = 0, startY = 0, pid = null;

    function pressOnce() {
      Audio2.init(); Audio2.resume();
      const r = game.pressBell();
      if (r.result === 'cooldown') return;
      if (r.result === 'locked') flashBell('locked-flash');
      updateHud();
    }
    function clearHold() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
      bellEl.classList.remove('pressed');
      pid = null;
    }
    bellEl.addEventListener('pointerdown', e => {
      e.preventDefault();
      Audio2.init(); Audio2.resume();
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      bellEl.classList.add('pressed'); // 100ms以内の一次反応 (沈み込み+発光)
      pressOnce();
      holdTimer = setTimeout(() => {
        repeatTimer = setInterval(pressOnce, BALANCE.bell.holdRepeat * 1000);
      }, BALANCE.bell.holdStart * 1000);
    });
    bellEl.addEventListener('pointermove', e => {
      if (pid === null || e.pointerId !== pid) return;
      // スクロール判定距離を越えたら長押しを必ず解除 (§12.3)
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 14) clearHold();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => bellEl.addEventListener(ev, clearHold));
    bellEl.addEventListener('contextmenu', e => e.preventDefault());
  })();

  function flashBell(cls) {
    bellEl.classList.remove(cls); void bellEl.offsetWidth; bellEl.classList.add(cls);
  }

  /* =====================================================================
   * ボトムシート (モーダルは全面を覆わない)
   * =================================================================== */
  const sheetRoot = el('sheets');
  function openSheet(id, html) {
    closeSheets();
    const d = document.createElement('div');
    d.className = 'sheet';
    d.id = id;
    d.innerHTML = html;
    sheetRoot.appendChild(d);
    requestAnimationFrame(() => d.classList.add('open'));
    return d;
  }
  function closeSheets() { sheetRoot.innerHTML = ''; }
  function sheetButton(sheet, cls, fn) {
    sheet.querySelectorAll(cls).forEach(b => b.addEventListener('click', e => { Audio2.ui(); fn(e, b); }));
  }

  /* ---------- ショップ選択 (§9.5: 必須比較の順で表示) ---------- */
  function openShopChoice(floor, candidates, isChange) {
    const def = FLOORS[floor];
    const rec = recommendShop();
    const cards = candidates.map(id => {
      const s = SHOPS[id];
      const dup = game.hasShop(id);
      return `<div class="card shop-card ${rec === id ? 'rec' : ''}">
        <div class="card-head"><span class="sicon">${s.icon}</span><b>${s.name}</b>
          ${rec === id ? '<span class="rec-badge">おすすめ</span>' : ''}
          ${dup ? '<span class="dup-badge">配置済み(効果逓減)</span>' : ''}</div>
        <p class="boost">${s.boost}</p>
        <p class="delivery-line">${s.deliveryIcon} 配送: ${s.deliveryItem}が前線へ届く</p>
        <p class="change-line">配置後: ${floor}Fが暖色の店舗階になり、猫が働き始める</p>
        <button class="primary pick-shop" data-shop="${id}">ここに置く</button>
      </div>`;
    }).join('');
    const sheet = openSheet('sheet-shop', `
      <h3>${floor}F ${def.name} に店を置く</h3>
      <p class="sheet-sub">選んだ店の物資が昇降機で上の階へ運ばれる。あとから変更もできる。</p>
      <div class="cards">${cards}</div>
      ${isChange ? '<button class="ghost close-sheet">閉じる</button>' : '<button class="ghost skip-shop">あとで選ぶ</button>'}
    `);
    sheetButton(sheet, '.pick-shop', (e, b) => {
      if (isChange) { game._choiceFloor = floor; game.shops[floor] = b.dataset.shop; game.shopTimers[floor] = 2.5; game._updateKohakuShopCondition(); game.emit('shop-placed', { floor, shopId: b.dataset.shop }); closeSheets(); }
      else { game._choiceFloor = floor; game.chooseShop(b.dataset.shop); closeSheets(); }
    });
    sheetButton(sheet, '.skip-shop', () => { game.skipShopChoice(); closeSheets(); });
    sheetButton(sheet, '.close-sheet', () => closeSheets());
  }

  function recommendShop() {
    const d = game.defeatInfo;
    if (!d) return null;
    const map = { shield: 'claw_forge', recovery: 'clinic', rotation: 'guild', antiair: 'fish_diner', frontline: 'guild' };
    for (const c of d.causes) if (map[c.id]) return map[c.id];
    return null;
  }

  /* ---------- 遺物3択 (9F) ---------- */
  function openRelicChoice() {
    const cards = Object.values(RELICS).map(r => `
      <div class="card relic-card">
        <div class="card-head"><span class="sicon">${r.icon}</span><b>${r.name}</b><span class="kind">${r.kind}</span></div>
        <p class="boost">${r.desc}</p>
        <button class="primary pick-relic" data-relic="${r.id}">この遺物を持つ</button>
      </div>`).join('');
    const sheet = openSheet('sheet-relic', `
      <h3>市場の遺物 — 1つだけ選ぶ</h3>
      <p class="sheet-sub">この周回の間だけ有効。方針に合うものを。</p>
      <div class="cards">${cards}</div>
    `);
    sheetButton(sheet, '.pick-relic', (e, b) => { game.chooseRelic(b.dataset.relic); closeSheets(); });
  }

  /* ---------- 猫名簿 (未解放猫の条件と進捗を常時公開, §4/§8) ---------- */
  function openRoster() {
    const rows = Object.values(CATS).map(c => {
      const un = game.unlocked[c.id];
      let cond = '';
      if (!un) {
        if (c.id === 'luna') cond = `<div class="cond">条件: ${c.unlock.label}<br>進捗: 補給箱 <b>${game.lunaProgress}/${c.unlock.need}</b></div>`;
        else if (c.id === 'toto') cond = `<div class="cond">条件: ${c.unlock.label}</div>`;
        else if (c.id === 'kohaku') {
          cond = '<div class="cond">' + game.kohakuConditions().map(k =>
            `<div class="kcond ${k.done ? 'done' : ''}">${k.done ? '✅' : '⬜'} ${k.label} <b>${k.progress}</b></div>`).join('') + '</div>';
        }
      }
      const fb = ASSETS.cats[c.id].fallback;
      return `<div class="roster-row ${un ? '' : 'locked'}">
        <span class="portrait" style="background:${fb.tint}">${un ? '🐱' : '🔒'}</span>
        <div class="roster-info"><b>${c.name}</b> <span class="role">${c.roleName}</span>
        <p>${c.desc}</p>${cond}</div>
      </div>`;
    }).join('');
    const canRetry8 = game.maxFloorReached >= 8 && !game.unlocked.kohaku && game.mode !== 'defeat';
    const sheet = openSheet('sheet-roster', `
      <h3>猫名簿</h3>
      ${rows}
      <h4>一時増援 (呼び鈴)</h4>
      <p class="sheet-sub">${Object.values(HELPERS).map(h => h.name + '=' + h.role).join(' / ')} — 敵の構成で出やすい役割が変わる</p>
      ${canRetry8 ? '<button class="primary retry-8">8Fへ再挑戦 (コハク条件)</button>' : ''}
      <button class="ghost close-sheet">閉じる</button>
    `);
    sheetButton(sheet, '.close-sheet', () => closeSheets());
    sheetButton(sheet, '.retry-8', () => { closeSheets(); game.replayFloor(8); });
  }

  /* ---------- 強化 ---------- */
  function openUpgrades() {
    const rows = Object.keys(BALANCE.upgrades).map(k => {
      const u = BALANCE.upgrades[k];
      const lv = game.upgrades[k];
      const cost = game.upgradeCost(k);
      return `<div class="up-row">
        <span class="sicon">${u.icon}</span>
        <div class="up-info"><b>${u.name}</b> Lv.${lv}<p>${u.desc}</p></div>
        ${cost == null ? '<span class="max">MAX</span>'
          : `<button class="primary buy-up" data-kind="${k}" ${game.coins < cost ? 'disabled' : ''}>${cost}¢</button>`}
      </div>`;
    }).join('');
    const sheet = openSheet('sheet-upgrade', `<h3>強化</h3><p class="sheet-sub">コインで即時に強くなる。次の撃破が速くなるはず。</p>${rows}<button class="ghost close-sheet">閉じる</button>`);
    sheetButton(sheet, '.buy-up', (e, b) => {
      if (game.buyUpgrade(b.dataset.kind)) {
        showBanner('強化した!', 1);
        closeSheets(); openUpgrades(); // 価格更新
      }
    });
    sheetButton(sheet, '.close-sheet', () => closeSheets());
  }

  /* ---------- 敗北診断 (§15) ---------- */
  function onDefeat(ev) {
    Audio2.defeat();
    const causes = ev.causes.map(c => `
      <div class="cause"><b>${c.label}</b><p>${c.hint}</p></div>`).join('');
    const sheet = openSheet('sheet-defeat', `
      <h3>${ev.floor}F で敗北…</h3>
      ${causes}
      <div class="btn-col">
        <button class="primary retry-now">すぐ再戦</button>
        <button class="ghost fix-roster">編成を見る</button>
        <button class="ghost fix-shop">店舗を直す</button>
        ${game.dawnNoticed ? '<p class="sheet-sub">「夜明け」(引き継ぎ再挑戦) はプロトタイプでは未実装です</p>' : ''}
      </div>
    `);
    sheetButton(sheet, '.retry-now', () => { closeSheets(); game.retryFloor(); });
    sheetButton(sheet, '.fix-roster', () => { openRoster(); });
    sheetButton(sheet, '.fix-shop', () => openShopChange());
  }

  function openShopChange() {
    const shopFloors = Object.keys(game.shops);
    if (!shopFloors.length) { showBanner('まだ店舗がない', 1.2); return; }
    const latest = parseInt(shopFloors[shopFloors.length - 1], 10);
    openShopChoice(latest, ['guild', 'fish_diner', 'claw_forge', 'clinic'], true);
  }

  /* ---------- 猫解放演出 (自動加入トーストではない) ---------- */
  function onUnlockCat(ev) {
    Audio2.unlock();
    const c = CATS[ev.catId];
    const fb = ASSETS.cats[ev.catId].fallback;
    const stories = {
      'luna-pop': { title: '補給箱からルナが飛び出した!', text: '3回目の箱と一緒に現れた狙撃手。遠距離・対空のエースが仲間に。' },
      'rescue': { title: 'トトを助け出した!', text: '閉じ込められていた診療猫。回復包帯で仲間を支える。' },
      'gate-burst': { title: '封鎖門の裏からコハクが飛び出した!', text: '条件を全て達成。走者・後列妨害の切り札が配送路を開通させる。' }
    };
    const s = stories[ev.style] || { title: c.name + 'が仲間になった!', text: c.desc };
    const sheet = openSheet('sheet-unlock', `
      <div class="unlock-art" style="background:radial-gradient(circle at 50% 60%, ${fb.tint}55, transparent 70%)">
        <span class="unlock-cat" style="background:${fb.tint}">🐱</span>
      </div>
      <h3>${s.title}</h3>
      <p class="sheet-sub">${c.name} — ${c.roleName}</p>
      <p>${s.text}</p>
      <button class="primary close-sheet">よろしく!</button>
    `);
    sheet.classList.add('unlock-sheet');
    sheetButton(sheet, '.close-sheet', () => closeSheets());
    burst(view.w / 2, view.h / 2, 24, fb.tint, 140, 0.9);
  }

  /* ---------- 地区制覇 (10F) ---------- */
  function onDistrictClear() {
    Audio2.clear();
    const sheet = openSheet('sheet-clear', `
      <h3>🏆 第1地区「灰かぶり入口市場」制覇!</h3>
      <p>猫たちが大広間に集まり、市場再開を祝っている。カゲツバサは上階へ退却した——塔は100Fまで続く。</p>
      <p class="sheet-sub">到達: ${game.maxFloorReached}F / コイン: ${game.coins} / 11F以降は未制作です</p>
      <div class="btn-col">
        <button class="primary view-tower2">塔を見る</button>
        <button class="ghost restart">もう一度あそぶ</button>
      </div>
    `);
    sheet.classList.add('unlock-sheet');
    sheetButton(sheet, '.view-tower2', () => { closeSheets(); openTower(); });
    sheetButton(sheet, '.restart', () => { closeSheets(); game.resetRun(); game.mode = 'battle'; game.emit('floor-enter', { floor: 1, def: game.floorDef(1) }); });
  }

  /* =====================================================================
   * 塔閲覧モード (§12): モーダルではない。閲覧中も戦闘は継続
   * =================================================================== */
  const towerEl = el('tower-view');
  let towerOpen = false;

  function openTower() {
    towerOpen = true;
    renderTowerList();
    towerEl.classList.add('open');
    el('tower-return').textContent = '戦闘へ戻る・現在 ' + game.floor + 'F';
  }
  function closeTower() {
    towerOpen = false;
    towerEl.classList.remove('open');
  }

  function renderTowerList() {
    const list = el('tower-list');
    let html = '';
    // 地区レール用: 11F以降は輪郭のみ
    for (let n = 10; n >= 1; n--) {
      const def = FLOORS[n];
      const conquered = n < game.floor || (n <= game.maxFloorReached && n !== game.floor) || (game.mode === 'cleared' && n <= 10);
      const current = n === game.floor && game.mode !== 'cleared';
      const shopId = game.shops[n];
      let body = '';
      if (conquered) {
        const facility = shopId ? SHOPS[shopId] : null;
        const workerId = facility ? facility.worker : 'mugi';
        const wfb = ASSETS.cats[workerId] ? ASSETS.cats[workerId].fallback : { tint: '#e0a44f' };
        body = `<div class="tf-scene warm">
          ${facility ? `<span class="tf-shop">${facility.icon}</span><span class="tf-shopname">${facility.name}</span>
          <span class="tf-item">${facility.deliveryIcon}</span>` : `<span class="tf-shop">${facilityIcon(def)}</span><span class="tf-shopname">${def.after ? def.after.label || facilityName(def) : ''}</span>`}
          <span class="tf-cat" style="background:${wfb.tint}">🐱</span>
        </div>`;
      } else if (current) {
        const aliveE = game.enemies.filter(e => !e.dead).length;
        body = `<div class="tf-scene current"><span class="tf-battle">⚔️ 戦闘中 — 敵 ${aliveE}体</span></div>`;
      } else {
        body = `<div class="tf-scene dim"><span class="tf-teach">次: ${def.teach}</span></div>`;
      }
      html += `<div class="t-floor ${conquered ? 'conquered' : ''} ${current ? 'current' : ''}" data-floor="${n}">
        <div class="tf-head"><b>${n}F</b> ${def.name}
          <span class="tf-state">${conquered ? '制圧済み' : current ? '戦闘中' : '未制圧'}</span></div>
        ${body}
      </div>`;
    }
    html += `<div class="t-floor locked-future"><div class="tf-head"><b>11〜100F</b></div>
      <div class="tf-scene dim"><span class="tf-teach">未制作 — 輪郭のみ (第2地区以降)</span></div></div>`;
    list.innerHTML = html;
  }

  function facilityIcon(def) {
    const map = { supply: '📦', lift: '🛗', 'cat-room': '🛏️', board: '🪧', memorial: '🏺', hall: '🏛️' };
    return map[def.after ? def.after.type : ''] || '🏠';
  }
  function facilityName(def) {
    const map = { lift: '物資昇降機', board: '依頼掲示板', memorial: '市場記念室', hall: '灰鈴大広間' };
    return map[def.after ? def.after.type : ''] || '';
  }

  // 配送箱: 出発階カードから前線カードへ実際に移動する (§10.1 禁止: 瞬間移動)
  function renderTowerDeliveries() {
    const layer = el('tower-boxes');
    const listRect = el('tower-list').getBoundingClientRect();
    const seen = {};
    for (const d of game.deliveries) {
      const from = towerEl.querySelector(`[data-floor="${d.fromFloor}"]`);
      const to = towerEl.querySelector(`[data-floor="${Math.min(d.toFloor, game.floor)}"]`);
      if (!from || !to) continue;
      let box = layer.querySelector(`[data-uid="${d.uid}"]`);
      if (!box) {
        box = document.createElement('div');
        box.className = 'tbox';
        box.dataset.uid = d.uid;
        box.textContent = SHOPS[d.shopId].deliveryIcon;
        layer.appendChild(box);
      }
      seen[d.uid] = true;
      const p = Math.min(1, (game.time - d.depart) / d.travel);
      const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
      const y = fr.top + (tr.top - fr.top) * p - listRect.top;
      box.style.top = y + 'px';
    }
    layer.querySelectorAll('.tbox').forEach(b => { if (!seen[b.dataset.uid]) b.remove(); });
  }

  /* =====================================================================
   * 入力: 塔スクロール (戦闘面を縦ドラッグで塔閲覧へ)
   * =================================================================== */
  (function setupCanvasDrag() {
    let startY = null, pid = null;
    canvas.addEventListener('pointerdown', e => { pid = e.pointerId; startY = e.clientY; });
    canvas.addEventListener('pointermove', e => {
      if (pid === null || e.pointerId !== pid || startY === null) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 70 && !towerOpen) { openTower(); pid = null; }
    });
    ['pointerup', 'pointercancel'].forEach(ev => canvas.addEventListener(ev, () => { pid = null; startY = null; }));
  })();

  /* =====================================================================
   * タイトル & 起動
   * =================================================================== */
  function startGame() {
    Audio2.init(); Audio2.resume();
    el('title-screen').classList.add('hide');
    game.mode = 'battle';
    game.emit('floor-enter', { floor: 1, def: game.floorDef(1) });
  }

  function boot() {
    resize();
    loadAssets().then(() => { /* 画像があれば以降自動で使用 */ });
    el('btn-start').addEventListener('click', startGame);
    el('btn-mute').addEventListener('click', () => {
      Audio2.init();
      Audio2.setMuted(!Audio2.muted);
      el('btn-mute').textContent = Audio2.muted ? '🔇' : '🔊';
    });
    el('btn-mute').textContent = Audio2.muted ? '🔇' : '🔊';
    el('btn-tower').addEventListener('click', () => { Audio2.ui(); openTower(); });
    el('tower-return').addEventListener('click', () => { Audio2.ui(); closeTower(); });
    el('btn-roster').addEventListener('click', () => { Audio2.ui(); openRoster(); });
    el('btn-upgrade').addEventListener('click', () => { Audio2.ui(); openUpgrades(); });
    // 店舗カードからの再配置 (塔ビューで制圧階タップ)
    el('tower-list').addEventListener('click', e => {
      const card = e.target.closest('.t-floor.conquered');
      if (!card) return;
      const n = parseInt(card.dataset.floor, 10);
      if (game.shops[n]) { closeTower(); openShopChoice(n, ['guild', 'fish_diner', 'claw_forge', 'clinic'], true); }
    });
    setInterval(() => { if (towerOpen) { renderTowerList(); } updateHud(); }, 1000);
    requestAnimationFrame(loop);
  }

  /* ---------- 検証用デモモード (?demo=1): 自動でベルを押し進行する ---------- */
  if (/[?&]demo=1/.test(location.search)) {
    setInterval(() => {
      if (el('title-screen') && !el('title-screen').classList.contains('hide')) { startGame(); return; }
      if (towerOpen) return;
      const pickBtn = document.querySelector('#sheets .pick-shop, #sheets .pick-relic, #sheets .close-sheet, #sheets .retry-now');
      if (pickBtn && game.mode !== 'battle') { pickBtn.click(); return; }
      if (game.mode === 'defeat') { const b = document.querySelector('.retry-now'); if (b) b.click(); return; }
      if (game.mode === 'battle') {
        if (game.bellReady()) game.pressBell();
        if (game.upgradeCost('atk') != null && game.coins >= game.upgradeCost('atk') * 1.5) game.buyUpgrade('atk');
        else if (game.upgradeCost('hp') != null && game.coins >= game.upgradeCost('hp') * 2) game.buyUpgrade('hp');
      }
    }, 700);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
