/* =========================================================================
 * Cat's Tower — 商人サーガ忠実版 (CLONE_DESIGN.md 準拠)
 * app.js : Canvas描画・WebAudio・UI (game-core.js のシミュレーションを可視化)
 *
 *   - 演出は「物量感」優先: 猫は最大24体個別描画、超過は ×N バッジ。
 *   - スプライト契約: visibleBounds [x,y,w,h] / footAnchor 接地 (現行維持)。
 *   - window.__game に Game インスタンスを公開 (検証用)。
 * ========================================================================= */
(function () {
  'use strict';

  const DATA = window.GAME_DATA;
  const {
    JOBS, JOB_ORDER, weaponAt, ITEMS, ITEM_ORDER,
    SHOP_TYPES, SHOP_ORDER, TREASURES, TREASURE_ORDER,
    ELEMENTS, floorElement, isBossFloor, BALANCE, ASSETS
  } = DATA;
  const fmt = DATA.fmt; // 和風単位 (game-data.js 正本)
  const SAVE_KEY = BALANCE.saveKey; // 'cats_tower_idle_v1'

  const game = new window.GAME_CORE.Game();
  window.__game = game; // 検証用テスト契約

  const el = id => document.getElementById(id);
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '"DotGothic16", "Hiragino Kaku Gothic ProN", sans-serif';

  /* =====================================================================
   * セーブ / ロード / オフライン収益
   * =================================================================== */
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize())); } catch (e) { /* 満杯時は無視 */ }
  }
  function load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { /* 破損時は新規 */ }
    if (!data) return;
    const elapsed = Date.now() - (data.lastSave || Date.now());
    if (game.deserialize(data)) {
      const gain = game.offlineGain(elapsed);
      if (gain >= 1 && elapsed > 60 * 1000) {
        game.coins += gain;
        el('offline-gain').textContent = '💰 +' + fmt(gain) + ' コイン';
        el('modal-offline').hidden = false;
      }
    }
  }
  el('btn-close-offline').addEventListener('click', () => {
    el('modal-offline').hidden = true;
    Audio2.coin();
    save();
  });
  setInterval(save, BALANCE.autosaveSec * 1000);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  /* =====================================================================
   * アセットローダ
   * =================================================================== */
  const Images = {};
  const EXTRA_IMAGES = { 'bg.corridor': 'assets/saga/bg_corridor.webp' }; // バトル背景 (魔王城の廊下)
  function loadAssets() {
    const jobs = [];
    ['cats', 'enemies'].forEach(group => {
      Object.keys(ASSETS[group]).forEach(id => {
        jobs.push(new Promise(resolve => {
          const img = new Image();
          img.onload = () => { Images[group + '.' + id] = img; resolve(); };
          img.onerror = () => resolve();
          img.src = ASSETS[group][id].src;
        }));
      });
    });
    Object.keys(ASSETS.bg).forEach(id => {
      jobs.push(new Promise(resolve => {
        const img = new Image();
        img.onload = () => { Images['bg.' + id] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = ASSETS.bg[id].src;
      }));
    });
    Object.keys(EXTRA_IMAGES).forEach(key => {
      jobs.push(new Promise(resolve => {
        const img = new Image();
        img.onload = () => { Images[key] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = EXTRA_IMAGES[key];
      }));
    });
    return Promise.all(jobs);
  }
  const getImg = (group, id) => Images[group + '.' + id] || null;

  /* =====================================================================
   * WebAudio 簡易シンセ (招集/命中/コイン/制圧/転生)
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
    summon() { const t = this.now(); this._noise(t, 0.14, 0.3, 900); this._osc('sine', 1320, t, 0.12, 0.25); },
    hit()    { const t = this.now(); this._noise(t, 0.05, 0.25, 1800); this._osc('sine', 200, t, 0.06, 0.2, 110); },
    faint()  { const t = this.now(); this._osc('square', 200, t, 0.1, 0.18, 120); },
    coin()   { const t = this.now(); this._osc('sine', 988, t, 0.07, 0.3); this._osc('sine', 1319, t + 0.06, 0.12, 0.3); },
    clear()  { const t = this.now(); [523, 659, 784, 1047].forEach((f, i) => this._osc('triangle', f, t + i * 0.11, 0.22, 0.35)); },
    boss()   { const t = this.now(); this._osc('sawtooth', 90, t, 0.5, 0.4, 55); this._noise(t, 0.4, 0.3, 300); },
    dawn()   { const t = this.now(); [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this._osc('sine', f, t + i * 0.13, 0.3, 0.3)); },
    build()  { const t = this.now(); this._osc('triangle', 300, t, 0.1, 0.3); this._osc('triangle', 450, t + 0.1, 0.16, 0.3); },
    buy()    { const t = this.now(); this._osc('sine', 784, t, 0.09, 0.25); this._osc('sine', 1175, t + 0.07, 0.12, 0.25); },
    ui()     { const t = this.now(); this._osc('sine', 700, t, 0.05, 0.15); }
  };

  /* =====================================================================
   * Canvas セットアップ
   * =================================================================== */
  const canvas = el('battle');
  const mainCtx = canvas.getContext('2d');
  // オフスクリーン低解像度canvasに描画→拡大転送でドット絵化 (visual_spec B)
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d');
  let ctx = offCtx; // 描画関数はすべてオフスクリーンへ
  const PIXEL_DIV = 1.6; // 低解像度化率 (幅=表示幅の約1/1.6。粒感は残しつつ階層アートを視認できる精細さに)
  let view = { w: 390, h: 300, scale: 1, dpr: 1 };
  const flipX = x => view.w - x; // 左右反転: 敵=左 / 猫=右から左へ進軍
  function groundY() { return view.h * 0.82; }

  function resize() {
    const wrap = el('battle-wrap');
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (!cw || !ch) return;
    view.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * view.dpr);
    canvas.height = Math.round(ch * view.dpr);
    offCanvas.width = Math.max(1, Math.round(cw / PIXEL_DIV));
    offCanvas.height = Math.max(1, Math.round(ch / PIXEL_DIV));
    view.scale = cw / BALANCE.world.width;
    view.w = BALANCE.world.width;
    view.h = ch / view.scale;
  }
  window.addEventListener('resize', resize);

  /* =====================================================================
   * エフェクト状態 (描画専用)
   * =================================================================== */
  const fx = {
    dmg: [],      // ダメージ数字 {x,y,txt,color,t,strong}
    coins: [],    // コイン飛行 {x0,y0,t}
    parts: [],    // パーティクル
    pendingDmg: 0, pendingDmgT: 0, // ダメージ数字の集約バケツ
    shake: 0,
    flashT: 0     // 制圧時の暖色フラッシュ
  };
  function burst(x, y, n, color, speed, life) {
    if (REDUCED) n = Math.min(4, n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (speed || 60) * (0.4 + Math.random() * 0.8);
      fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, life: life || 0.5, color, size: 2 + Math.random() * 3 });
    }
  }
  function addDmgNum(x, y, txt, color, strong) {
    if (fx.dmg.length > 40) return;
    fx.dmg.push({ x, y, txt, color, t: 0, strong: !!strong });
  }
  function hudCoinPos() {
    const r = el('hud-coins').getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - cr.left) / view.scale, y: (r.top + r.height / 2 - cr.top) / view.scale };
  }

  /* =====================================================================
   * スプライト描画 (visibleBounds [x,y,w,h] / footAnchor 契約)
   * =================================================================== */
  function spriteMetrics(img, meta, scale) {
    const vb = meta.visibleBounds || [0, 0, 1, 1];
    const visH = Math.max(0.05, vb[3]); // [x, y, w, h] 形式 (anchors.json 契約)
    const drawH = meta.displayHeight * scale;
    const h = drawH / visH;
    const w = h * (img.width / img.height);
    return {
      w, h,
      dx: -w * meta.footAnchor[0],
      dy: -h * meta.footAnchor[1],
      topY: -h * (meta.footAnchor[1] - vb[1])
    };
  }

  function drawSprite(group, id, x, y, scale, t, opts) {
    opts = opts || {};
    const meta = ASSETS[group][id];
    const img = getImg(group, id);
    ctx.save();
    ctx.translate(x, y);
    if (opts.faint) ctx.rotate(-Math.PI / 2 * 0.85);
    if (opts.flip) ctx.scale(-1, 1); // 左右反転 (進行方向に合わせる)
    const bob = opts.walking ? Math.abs(Math.sin(t * 10 + (opts.uid || 0))) * 3
      : Math.sin(t * 2 + (opts.uid || 0)) * 1.2;
    ctx.translate(0, -bob);
    if (img) {
      // 明るくなった背景上での視認性確保: 敵には薄い暗縁の発光を添える
      if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = 6; }
      const sm = spriteMetrics(img, meta, scale);
      ctx.drawImage(img, sm.dx, sm.dy, sm.w, sm.h);
    } else {
      // フォールバック: 色つきシルエット
      const h = meta.displayHeight * scale;
      ctx.fillStyle = meta.fallback.tint;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.45, h * 0.42, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(h * 0.12, -h * 0.55, h * 0.05, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawShadow(x, y, w) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, w, w * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* =====================================================================
   * 背景描画 (10階ごとに地区色調変更, §4.4)
   * =================================================================== */
  function drawBackground() {
    const H = view.h, gy = groundY();
    // 魔王城の廊下 (assets/saga/bg_corridor.webp)
    const img = Images['bg.corridor'];
    if (img) {
      const s = Math.max(view.w / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      // 実機FB: 元アート(平均輝度≒29/255)が暗すぎて階層が認識できないため明度を持ち上げる。
      // ctx.filter 非対応環境では無害に無視され従来表示にフォールバックする。
      if ('filter' in ctx) ctx.filter = 'brightness(1.55) saturate(1.08)';
      ctx.drawImage(img, (view.w - dw) / 2, (H - dh) / 2, dw, dh);
      if ('filter' in ctx) ctx.filter = 'none';
    } else {
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#2b2138'); grd.addColorStop(1, '#14101f');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, view.w, H);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 4; i++) ctx.fillRect(30 + i * 110, H * 0.08, 26, gy - H * 0.08);
    }
    // 床
    const g2 = ctx.createLinearGradient(0, gy, 0, H);
    g2.addColorStop(0, '#3a2f4a'); g2.addColorStop(1, '#1e1830');
    ctx.fillStyle = g2;
    ctx.fillRect(0, gy, view.w, H - gy);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, gy, view.w, 2);
    // 制圧フラッシュ
    if (fx.flashT > 0) {
      ctx.fillStyle = 'rgba(255,200,100,' + (fx.flashT * 0.25) + ')';
      ctx.fillRect(0, 0, view.w, H);
    }
    // 敵の出現口 (左) と猫の入口 (右)
    drawEntrance(0, gy, 'left');
    drawEntrance(view.w, gy, 'right');
    // ボス階の警告色
    if (isBossFloor(game.floor)) {
      ctx.fillStyle = 'rgba(200,60,60,' + (0.06 + Math.sin(performance.now() / 400) * 0.03) + ')';
      ctx.fillRect(0, 0, view.w, H);
    }
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

  /* =====================================================================
   * ユニット描画
   * =================================================================== */
  function drawUnits(t) {
    const gy = groundY();
    const cats = game.fieldCats;
    // 個別描画は最大24体、超過は ×N バッジ (§4.1)
    const drawList = cats.slice(0, 24);
    const excess = cats.length - drawList.length;
    // Yずらしで重なり軽減
    const laneDy = c => (c.uid % 3) * 9;
    for (const c of drawList) {
      const cx = flipX(c.x); // 猫は右から左へ進軍
      const y = gy + laneDy(c);
      drawShadow(cx, y, 14);
      drawSprite('cats', JOBS[c.jobId].sprite, cx, y, 1, t, {
        uid: c.uid, walking: c.state === 'walk' || c.state === 'faint', faint: c.state === 'faint', flip: true
      });
    }
    if (excess > 0) {
      ctx.save();
      ctx.font = '13px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(view.w - 52, gy - 84, 48, 20);
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText('×' + excess, view.w - 46, gy - 70);
      ctx.restore();
    }
    // 敵 (ザコ連続出現 / ボス1体) — 左側に大きく
    for (const e of game.enemies) {
      const ex = flipX(e.x);
      const y = gy + (e.kind === 'add' ? 14 : 4);
      drawShadow(ex, y, e.boss ? 34 : 18);
      const flyH = (e.sprite === 'smoke_bat' || e.sprite === 'scrap_crow') ? 26 + Math.sin(t * 3 + e.uid) * 4 : 0;
      drawSprite('enemies', e.sprite, ex, y - flyH, 1, t, { uid: e.uid, walking: false, flip: true, glow: 'rgba(0,0,0,0.6)' });
      // 属性マーク (敵アイコン横) + 弱点/耐性の相性表示
      if (e.attr && e.attr !== 'none') {
        const el2 = ELEMENTS[e.attr];
        const em = game.elementMult(e);
        const mark = el2.mark + (em > 1 ? '⭕弱点' : em < 1 ? '▲耐性' : '');
        ctx.save();
        ctx.font = '11px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillStyle = em > 1 ? '#ffd75a' : em < 1 ? '#8ab0d8' : '#e8e4f0';
        ctx.strokeStyle = 'rgba(10,8,26,0.9)'; ctx.lineWidth = 3;
        const my = y - flyH - (e.boss ? 128 : 56);
        ctx.strokeText(mark, ex, my);
        ctx.fillText(mark, ex, my);
        ctx.restore();
      }
      // ザコの小HPバー
      if (e.kind === 'add') {
        const w = 30, r = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(ex - w / 2 - 1, y - flyH - 46, w + 2, 5);
        ctx.fillStyle = '#e05a4a';
        ctx.fillRect(ex - w / 2, y - flyH - 45, w * r, 3);
      }
    }
    // ボスHPバー / 通常階は撃破カウンタ (画面上部に大きく)
    const g = game.guardian;
    const w = view.w - 40, x = 20, y = 12;
    ctx.save();
    ctx.textAlign = 'center';
    if (g) {
      // ボスHPバー: 太め (高さ2倍) + 大きな王冠テキスト
      const r = Math.max(0, g.hp / g.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x - 2, y - 2, w + 4, 28);
      const grd = ctx.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, '#c04ae0'); grd.addColorStop(1, '#e05a4a');
      ctx.fillStyle = grd;
      ctx.fillRect(x, y, w * r, 24);
      ctx.font = '15px ' + FONT;
      ctx.strokeStyle = '#141030'; ctx.lineWidth = 4;
      const attrMark = (g.attr && g.attr !== 'none') ? ELEMENTS[g.attr].mark : '';
      const bossTxt = '👑 BOSS ' + game.floor + 'F ' + attrMark + '  ' + fmt(g.hp) + ' / ' + fmt(g.maxHp);
      ctx.strokeText(bossTxt, view.w / 2, y + 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(bossTxt, view.w / 2, y + 18);
    } else {
      // 撃破 N/M (制圧までの進捗バー) — 白+濃紺アウトラインで視認性確保
      const r = Math.min(1, game.kills / game.killNeed);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x - 2, y - 2, w + 4, 20);
      const grd = ctx.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, '#e05a4a'); grd.addColorStop(1, '#e09a3a');
      ctx.fillStyle = grd;
      ctx.fillRect(x, y, w * r, 16);
      ctx.font = '13px ' + FONT;
      ctx.strokeStyle = '#141030'; ctx.lineWidth = 4;
      const cntTxt = game.floor + 'F  撃破 ' + game.kills + '/' + game.killNeed;
      ctx.strokeText(cntTxt, view.w / 2, y + 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(cntTxt, view.w / 2, y + 12);
    }
    ctx.restore();
  }

  /* =====================================================================
   * エフェクト描画
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
    // ダメージ数字
    ctx.textAlign = 'center';
    for (let i = fx.dmg.length - 1; i >= 0; i--) {
      const d = fx.dmg[i];
      d.t += dt;
      if (d.t > 0.9) { fx.dmg.splice(i, 1); continue; }
      const p = d.t / 0.9;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = (d.strong ? '24px ' : '17px ') + FONT; // 大きめ白ドット数字
      ctx.strokeStyle = '#141030'; ctx.lineWidth = 4; // 濃紺アウトライン
      const y = d.y - p * 30;
      ctx.strokeText(d.txt, d.x, y);
      ctx.fillStyle = d.color;
      ctx.fillText(d.txt, d.x, y);
    }
    ctx.globalAlpha = 1;
    // コイン飛行 → HUD
    const target = hudCoinPos();
    for (let i = fx.coins.length - 1; i >= 0; i--) {
      const c = fx.coins[i];
      c.t += dt * 1.6;
      if (c.t >= 1) { fx.coins.splice(i, 1); bumpCoins(); continue; }
      const e = 1 - Math.pow(1 - c.t, 2);
      const x = c.x0 + (target.x - c.x0) * e;
      const y = c.y0 + (target.y - c.y0) * e - Math.sin(c.t * Math.PI) * 30;
      ctx.fillStyle = '#ffd75a';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
  function bumpCoins() {
    const c = el('hud-coins');
    c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  }

  /* =====================================================================
   * コアイベント → 音・エフェクト
   * =================================================================== */
  let hitSoundT = 0;
  function processEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'summon':
        case 'auto-spawn':
          if (ev.type === 'summon') Audio2.summon();
          burst(view.w - 30, groundY() - 10, 6, 'rgba(190,175,150,0.8)', 50, 0.4);
          break;
        case 'hit':
          fx.pendingDmg += ev.dmg;
          if (performance.now() - hitSoundT > 120) { Audio2.hit(); hitSoundT = performance.now(); }
          break;
        case 'cat-faint':
          Audio2.faint();
          break;
        case 'add-down':
          burst(flipX(ev.x), groundY() - 16, 8, '#c9c2b8', 90, 0.5);
          if (Math.floor(ev.coin) >= 1) addDmgNum(flipX(ev.x), groundY() - 60, '+' + fmt(ev.coin), '#ffd75a', false); // 「+0」フロートは出さない
          break;
        case 'floor-clear': {
          Audio2.clear();
          fx.flashT = 1;
          showBanner(ev.boss ? '👑 ' + ev.floor + 'F ボス制圧! 空き階OPEN' : ev.floor + 'F 制圧! 空き階OPEN — 塔から建店', 1.6, ev.boss);
          addDmgNum(view.w / 2, groundY() - 90, '+' + fmt(ev.coin) + '💰', '#ffd75a', true);
          for (let i = 0; i < 5; i++) fx.coins.push({ x0: view.w - 300 + i * 8, y0: groundY() - 60, t: -i * 0.09 });
          burst(view.w - 300, groundY() - 30, 16, '#ffd75a', 120, 0.7);
          if (!REDUCED) fx.shake = Math.max(fx.shake, ev.boss ? 7 : 3);
          // 実機FB: 建店2択シートは自動で開かない。保留件数をバッジ表示するだけ (手動: 🏪バッジ or 塔リストの空き階＋)
          updateHud();
          break;
        }
        case 'floor-enter':
          if (ev.boss) { Audio2.boss(); showBanner('⚠️ ' + ev.floor + 'F はボス階', 1.6); }
          updateHud();
          break;
        case 'dawn': // 転生
          Audio2.dawn();
          showBanner('🔄 転生 — 💎' + ev.gain + ' ルビーを得た', 2.2, true);
          fx.flashT = 2;
          break;
        case 'shop-built':
          Audio2.build();
          showBanner(SHOP_TYPES[ev.shopId].icon + ' ' + SHOP_TYPES[ev.shopId].name + 'を建てた!', 1.4);
          break;
        case 'hire': case 'weapon-buy': case 'item-buy': case 'job-lvup':
          Audio2.buy();
          break;
      }
    }
  }

  const bannerEl = el('banner');
  let bannerTimer = null;
  function showBanner(text, dur, big) {
    bannerEl.textContent = text;
    bannerEl.classList.toggle('big', !!big);
    bannerEl.classList.add('show');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), (dur || 1.5) * 1000);
  }

  /* =====================================================================
   * HUD 更新
   * =================================================================== */
  function updateHud() {
    const attr = floorElement(game.floor);
    el('hud-floor').textContent = game.floor + 'F' + (attr !== 'none' ? ' ' + ELEMENTS[attr].mark : '') + (isBossFloor(game.floor) ? ' 👑' : '');
    el('hud-coins').textContent = fmt(game.coins) + 'G';
    el('hud-sparkles').textContent = fmt(game.sparkles);
    el('hud-income').textContent = '収益 +' + fmt(game.incomePerSec) + '/秒';
    el('hud-dps').textContent = '攻撃力:' + fmt(game.dps);
    const lastWeapon = game.weaponCount > 0 ? weaponAt(game.weaponCount) : null;
    el('hud-weapon').textContent = 'E:' + (lastWeapon ? lastWeapon.name : '—');
    const dawn = el('btn-dawn');
    const ok = game.prestigeAvailable;
    dawn.disabled = !ok;
    dawn.classList.toggle('ready', ok);
    dawn.title = ok ? '💎' + game.prestigeGain() + ' ルビーを得られる' : '10F制圧で解放';
    const pendN = game.pendingShopChoices.length;
    const pendBtn = el('btn-shop-pending');
    pendBtn.style.display = pendN ? '' : 'none';
    pendBtn.textContent = pendN ? '🏪 建店×' + pendN : '🏪 建店!'; // 保留件数をバッジ表示 (.accent の pulse アニメで軽く点滅)
    el('summon-sub').textContent = 'タップで' + game.tapCount() + '体招集 / 長押しで連打';
    renderTower();
  }

  /* =====================================================================
   * 招集ボタン (タップ=即招集 / 長押し連打, 0.12秒間隔上限)
   * =================================================================== */
  (function setupSummon() {
    const btn = el('btn-summon');
    let repeatTimer = null;
    function press() {
      Audio2.init(); Audio2.resume();
      game.tap(); // 間隔上限はコアが管理
    }
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      btn.classList.add('pressed');
      press();
      repeatTimer = setInterval(press, BALANCE.tapInterval * 1000);
    });
    function clear() {
      if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
      btn.classList.remove('pressed');
    }
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, clear));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  })();

  /* =====================================================================
   * ボトムシート
   * =================================================================== */
  const sheetRoot = el('sheets');
  function openSheet(html) {
    closeSheets();
    const d = document.createElement('div');
    d.className = 'sheet';
    d.innerHTML = html;
    sheetRoot.appendChild(d);
    requestAnimationFrame(() => d.classList.add('open'));
    return d;
  }
  function closeSheets() { sheetRoot.innerHTML = ''; }
  function wire(sheet, cls, fn) {
    sheet.querySelectorAll(cls).forEach(b => b.addEventListener('click', () => { Audio2.ui(); fn(b); }));
  }
  const spriteIconHtml = (group, id) => {
    const img = getImg(group, id);
    return img ? '<img src="' + ASSETS[group][id].src + '" alt="">' : '🐱';
  };

  /* ---------- 人材派遣屋 (職業の雇用/レベル) ---------- */
  function openAgency() {
    const totalLv = game.totalJobLv();
    const rows = JOB_ORDER.map(id => {
      const j = JOBS[id];
      const st = game.jobs[id];
      const unlocked = game.isJobUnlocked(id);
      if (!unlocked) {
        return '<div class="buy-row locked"><span class="ricon">🔒</span>' +
          '<div class="rinfo"><b>???</b><p>合計Lv' + j.unlockTotalLv + ' で解放 (現在 ' + totalLv + ')</p></div></div>';
      }
      const hireCost = game.jobHireCost(id);
      const lvCost = st ? game.jobLvCost(id) : null;
      const atk = st ? game.catDamage(id) : j.baseAtk * game.atkMult();
      return '<div class="buy-row"><span class="ricon">' + spriteIconHtml('cats', j.sprite) + '</span>' +
        '<div class="rinfo"><b>' + j.name + '</b> <small>' + j.role + '</small><br>' +
        '<small>所持 ' + (st ? st.owned : 0) + ' / Lv.' + (st ? st.lv : 0) + ' / 攻 ' + fmt(atk) + '</small>' +
        '<p>' + j.desc + '</p></div>' +
        '<div class="rbtns">' +
        '<button class="buy hire" data-id="' + id + '" ' + (game.coins < hireCost ? 'disabled' : '') + '>雇用 ' + fmt(hireCost) + '</button>' +
        (st ? '<button class="buy lvup" data-id="' + id + '" ' + (game.coins < lvCost ? 'disabled' : '') + '>Lv↑ ' + fmt(lvCost) + '</button>' : '') +
        '</div></div>';
    }).join('');
    const sheet = openSheet('<h3>🐾 人材派遣屋</h3><p class="sheet-sub">合計Lv ' + totalLv + ' — 雇用した勇者ねこは恒久的に編成へ。Lvで攻撃力+25%。<br>所持数 = 同時に戦場に出る仲間の数。多いほど連射が速くなる。</p>' + rows +
      '<button class="ghost close">閉じる</button>');
    wire(sheet, '.hire', b => { if (game.hireJob(b.dataset.id)) { updateHud(); openAgency(); } });
    wire(sheet, '.lvup', b => { if (game.levelUpJob(b.dataset.id)) { updateHud(); openAgency(); } });
    wire(sheet, '.close', closeSheets);
  }

  /* ---------- 武器屋 (属性武器) ---------- */
  function openForge() {
    const rank = game.weaponRank();
    if (rank < 1) {
      const sheet = openSheet('<h3>⚔️ 武器屋</h3>' +
        '<p class="sheet-sub">まだ武器屋が開店していない。<br><b>制圧した階に武器屋を建てよう</b> (制圧時の建店か、塔リストから建てられる)。</p>' +
        '<button class="ghost close">閉じる</button>');
      wire(sheet, '.close', closeSheets);
      return;
    }
    const attrLabel = w => (w.attr && w.attr !== 'none')
      ? ' <small>' + ELEMENTS[w.attr].mark + ELEMENTS[w.attr].name + '属性</small>' : '';
    const rows = [];
    const total = game.weaponCount;
    for (let k = 1; k <= total + 2; k++) {
      const w = weaponAt(k);
      const owned = !!game.weapons[w.id];
      const next = k === total + 1;
      if (owned) {
        rows.push('<div class="buy-row"><span class="ricon">' + w.icon + '</span>' +
          '<div class="rinfo"><b>' + w.name + '</b>' + attrLabel(w) + '<p>全攻撃 ×' + w.mult + ' (所持中)</p></div>' +
          '<span>✅</span></div>');
      } else if (next && game.isWeaponUnlocked(w)) {
        rows.push('<div class="buy-row"><span class="ricon">' + w.icon + '</span>' +
          '<div class="rinfo"><b>' + w.name + '</b>' + attrLabel(w) + '<p>全攻撃 ×' + w.mult + ' — 所持武器はすべて乗算で効く</p></div>' +
          '<div class="rbtns"><button class="buy wpn" ' + (game.coins < w.cost ? 'disabled' : '') + '>購入 ' + fmt(w.cost) + '</button></div></div>');
      } else {
        rows.push('<div class="buy-row locked"><span class="ricon">🔒</span>' +
          '<div class="rinfo"><b>???</b><p>武器をあと' + (k - total - 1) + '個購入で解放</p></div></div>');
      }
    }
    const sheet = openSheet('<h3>⚔️ 武器屋 <small>ランク' + rank + '</small></h3>' +
      '<p class="sheet-sub">現在の武器倍率: ×' + fmt(game.weaponMult()) +
      ' (同種ボーナス ×' + game.weaponShopBonus().toFixed(1) + ')<br>' +
      '敵の弱点属性の武器を持つとダメージ×1.5 / 耐性だと×0.5。</p>' + rows.join('') +
      '<button class="ghost close">閉じる</button>');
    wire(sheet, '.wpn', () => { if (game.buyWeapon()) { updateHud(); openForge(); } });
    wire(sheet, '.close', closeSheets);
  }

  /* ---------- 道具屋 ---------- */
  function openItemShop() {
    const rank = game.itemRank();
    if (rank < 1) {
      const sheet = openSheet('<h3>🎒 道具屋</h3>' +
        '<p class="sheet-sub">まだ道具屋が開店していない。<br><b>制圧した階に道具屋を建てよう</b> (制圧時の建店か、塔リストから建てられる)。</p>' +
        '<button class="ghost close">閉じる</button>');
      wire(sheet, '.close', closeSheets);
      return;
    }
    const rows = ITEM_ORDER.map(id => {
      const it = ITEMS[id];
      if (!game.isItemUnlocked(id)) {
        return '<div class="buy-row locked"><span class="ricon">🔒</span>' +
          '<div class="rinfo"><b>???</b><p>道具屋ランク' + it.unlockRank + ' で解放 (現在 ランク' + rank + ')</p></div></div>';
      }
      const n = game.items[id] || 0;
      const cost = game.itemCost(id);
      return '<div class="buy-row"><span class="ricon">' + it.icon + '</span>' +
        '<div class="rinfo"><b>' + it.name + '</b> ×' + n + '<p>' + it.desc + '</p></div>' +
        '<div class="rbtns"><button class="buy itm" data-id="' + id + '" ' + (game.coins < cost ? 'disabled' : '') + '>購入 ' + fmt(cost) + '</button></div></div>';
    }).join('');
    const sheet = openSheet('<h3>🎒 道具屋 <small>ランク' + rank + '</small></h3>' +
      '<p class="sheet-sub">%バフは繰り返し購入可。コストは逓増。同種ボーナス ×' + game.itemShopBonus().toFixed(1) + '。ランクで品ぞろえ解放。</p>' + rows +
      '<button class="ghost close">閉じる</button>');
    wire(sheet, '.itm', b => { if (game.buyItem(b.dataset.id)) { updateHud(); openItemShop(); } });
    wire(sheet, '.close', closeSheets);
  }

  /* ---------- 建店2択 (制圧時: 武器屋・道具屋) ---------- */
  function openPendingShopChoice() {
    const ch = game.pendingShopChoices[0];
    if (!ch) return;
    const cards = ch.options.map(id => {
      const s = SHOP_TYPES[id];
      const same = game.shopRank(id);
      return '<div class="card"><div class="card-head"><span class="sicon">' + s.icon + '</span><b>' + s.name + '</b>' +
        (same > 0 ? '<small>(' + (same + 1) + '件目 効果+' + same * 10 + '%)</small>' : '') + '</div>' +
        '<p>' + s.desc + '<br>売上 +' + fmt(DATA.shopIncome(ch.floor)) + '/秒</p>' +
        '<button class="primary pick-shop" data-id="' + id + '">ここに建てる</button></div>';
    }).join('');
    const sheet = openSheet('<h3>🏪 ' + ch.floor + 'F に店を建てる</h3>' +
      '<p class="sheet-sub">制圧した階が店舗になる。建設数=店ランク。あとから塔リストで建て替えもできる。</p>' +
      '<div class="cards">' + cards + '</div>' +
      '<button class="ghost skip">あとで決める</button>');
    wire(sheet, '.pick-shop', b => {
      game.buildShop(ch.floor, b.dataset.id);
      closeSheets(); updateHud();
      // 実機FB: 建てたら閉じるだけ。残りの保留件数はバッジ表示に任せ、連鎖で開かない
    });
    wire(sheet, '.skip', () => closeSheets());
  }

  /* ---------- 店舗タワー (常時表示・縦スクロール, visual_spec A) ---------- */
  const SHOP_STRIP_BG = { weapon: 'assets/saga/shop_weapon.webp', item: 'assets/saga/shop_item.webp' };
  const CAT_VARIANTS = ['gray', 'black', 'calico'];
  let towerSig = null;

  function catImgsHtml(seed, count) {
    let out = '';
    for (let i = 0; i < count; i++) {
      const v = CAT_VARIANTS[(seed + i) % CAT_VARIANTS.length];
      const dur = 7 + ((seed + i) % 3) * 2.5;
      const delay = -(((seed * 1.7 + i * 2.9) % 8)).toFixed(1);
      out += '<span class="tf-cat" style="--dur:' + dur + 's;--delay:' + delay + 's">' +
        '<img src="assets/saga/cat_' + v + '_0.png" data-v="' + v + '" data-pose="0" alt=""></span>';
    }
    return out;
  }
  function towerBarHtml(name, info, plusId, plusCls, plusAttrs) {
    return '<div class="tf-bar"><span class="tf-name">' + name + '</span>' +
      (info ? '<span class="tf-info">' + info + '</span>' : '') +
      '<button class="tf-plus' + (plusCls ? ' ' + plusCls : '') + '"' +
      (plusId ? ' id="' + plusId + '"' : '') + (plusAttrs || '') + '>＋</button></div>';
  }
  function towerStripHtml(bg, seed, cats) {
    return '<div class="tf-shop" style="background-image:url(\'' + bg + '\')">' + catImgsHtml(seed, cats) + '</div>';
  }

  function renderTower() {
    const sig = [game.maxFloor, game.totalJobLv(), JSON.stringify(game.shopsBuilt),
      game.pendingShopChoices.length, game.prestigeAvailable].join('|');
    if (sig === towerSig) return;
    towerSig = sig;
    const parts = [];
    let forgeIdUsed = false, itemIdUsed = false;
    // 🐾 人材派遣屋 (常駐)
    const agencyCats = Math.min(3, 1 + Math.floor(game.totalJobLv() / 15));
    parts.push('<div class="tower-floor" data-kind="agency">' +
      towerBarHtml('🐾 人材派遣屋', '合計Lv' + game.totalJobLv(), 'tab-agency') +
      towerStripHtml('assets/saga/shop_agency.webp', 1, agencyCats) + '</div>');
    // 💎 伝説の道具屋 (転生解放後)
    if (game.maxFloor >= BALANCE.prestigeUnlockFloor) {
      parts.push('<div class="tower-floor" data-kind="legend">' +
        towerBarHtml('💎 伝説の道具屋', '永続パッシブ', null, 'gold js-legend') +
        towerStripHtml('assets/saga/shop_legend.webp', 2, 2) + '</div>');
    }
    // 制圧階 (新しいもの=高い階が上)
    for (let n = game.maxFloor; n >= 1; n--) {
      const shopId = game.shopsBuilt[n];
      if (shopId && SHOP_TYPES[shopId]) {
        const s = SHOP_TYPES[shopId];
        let plusId = null;
        if (shopId === 'weapon' && !forgeIdUsed) { plusId = 'tab-forge'; forgeIdUsed = true; }
        if (shopId === 'item' && !itemIdUsed) { plusId = 'tab-item'; itemIdUsed = true; }
        parts.push('<div class="tower-floor" data-floor="' + n + '">' +
          towerBarHtml(s.icon + ' ' + s.name + ' ' + n + 'F', '売上+' + fmt(DATA.shopIncome(n)) + '/秒',
            plusId, 'js-shop', ' data-shop="' + shopId + '"') +
          towerStripHtml(SHOP_STRIP_BG[shopId] || SHOP_STRIP_BG.item, n, 2) + '</div>');
      } else {
        parts.push('<div class="tower-floor" data-floor="' + n + '">' +
          towerBarHtml((isBossFloor(n) ? '👑 ' : '') + n + 'F 空き階', '建店できます',
            null, 'js-vacant', ' data-f="' + n + '"') +
          '<div class="tf-shop vacant"><span class="tf-vacant-label">空き階</span></div>' +
          '</div>');
      }
    }
    // 最下部: 城門
    parts.push('<div class="tf-gate" style="background-image:url(\'assets/saga/castle_gate.webp\')"></div>');
    el('tower-list').innerHTML = parts.join('');
  }

  // 塔パネルの「＋」配線 (id互換: tab-agency/tab-forge/tab-item)
  el('tower-list').addEventListener('click', e => {
    const b = e.target.closest('.tf-plus');
    if (!b) return;
    Audio2.init(); Audio2.resume(); Audio2.ui();
    if (b.id === 'tab-agency') { openAgency(); return; }
    if (b.id === 'tab-forge') { openForge(); return; }
    if (b.id === 'tab-item') { openItemShop(); return; }
    if (b.classList.contains('js-legend')) {
      renderPrestigeModal();
      el('modal-prestige').hidden = false;
      return;
    }
    if (b.classList.contains('js-shop')) {
      if (b.dataset.shop === 'weapon') openForge(); else openItemShop();
      return;
    }
    if (b.classList.contains('js-vacant')) {
      const f = parseInt(b.dataset.f, 10);
      const idx = game.pendingShopChoices.findIndex(c => c.floor === f);
      if (idx > 0) {
        const c = game.pendingShopChoices.splice(idx, 1)[0];
        game.pendingShopChoices.unshift(c);
      } else if (idx < 0) {
        // フォールバック (旧セーブ等で選択肢が無い空き階)
        game.pendingShopChoices.unshift({ floor: f, options: SHOP_ORDER.slice() });
      }
      if (game.pendingShopChoices.length) openPendingShopChoice();
    }
  });

  // 店内で働く猫の歩行ポーズ切替 (0↔1)
  setInterval(() => {
    if (REDUCED) return;
    document.querySelectorAll('#tower-list .tf-cat img').forEach(img => {
      const p = img.dataset.pose === '0' ? '1' : '0';
      img.dataset.pose = p;
      img.src = 'assets/saga/cat_' + img.dataset.v + '_' + p + '.png';
    });
  }, 450);

  /* ---------- 転生モーダル (+伝説の道具屋) ---------- */
  function renderPrestigeModal() {
    const gain = game.prestigeGain();
    el('prestige-gain').textContent = game.prestigeAvailable
      ? '💎 +' + gain + ' ルビー (到達 ' + game.maxFloor + 'F / ボス撃破 ' + game.bossKills + ')'
      : '10F制圧で解放されます (現在 ' + game.maxFloor + 'F制圧済み)';
    el('btn-do-prestige').disabled = !game.prestigeAvailable;
    el('treasure-list').innerHTML = TREASURE_ORDER.map(id => {
      const t = TREASURES[id];
      const owned = !!game.treasures[id];
      return '<div class="buy-row"><span class="ricon">' + t.icon + '</span>' +
        '<div class="rinfo"><b>' + t.name + '</b><p>' + t.desc + '</p></div>' +
        (owned ? '<span>✅</span>'
          : '<div class="rbtns"><button class="buy treasure" data-id="' + id + '" ' + (game.sparkles < t.cost ? 'disabled' : '') + '>💎' + t.cost + '</button></div>') +
        '</div>';
    }).join('');
  }
  el('btn-dawn').addEventListener('click', () => {
    Audio2.init(); Audio2.resume(); Audio2.ui();
    renderPrestigeModal();
    el('modal-prestige').hidden = false;
  });
  el('btn-close-prestige').addEventListener('click', () => { el('modal-prestige').hidden = true; });
  el('btn-do-prestige').addEventListener('click', () => {
    const gain = game.prestige();
    if (gain > 0) {
      el('modal-prestige').hidden = true;
      closeSheets();
      updateHud();
      save();
    }
  });
  el('treasure-list').addEventListener('click', e => {
    const b = e.target.closest('.treasure');
    if (!b) return;
    if (game.buyTreasure(b.dataset.id)) { Audio2.buy(); renderPrestigeModal(); updateHud(); }
  });

  /* ---------- 塔・HUDボタン配線 ---------- */
  el('btn-shop-pending').addEventListener('click', () => { Audio2.ui(); openPendingShopChoice(); });
  el('btn-mute').addEventListener('click', () => {
    Audio2.init();
    Audio2.setMuted(!Audio2.muted);
    el('btn-mute').textContent = Audio2.muted ? '🔇' : '🔊';
  });
  el('btn-mute').textContent = Audio2.muted ? '🔇' : '🔊';

  /* =====================================================================
   * メインループ
   * =================================================================== */
  let lastT = 0;
  function loop(ts) {
    const dt = Math.min(0.1, (ts - lastT) / 1000 || 0.016);
    lastT = ts;

    game.update(dt);
    processEvents(game.drainEvents());

    // ダメージ数字の集約フラッシュ (0.3秒ごとに1個)
    fx.pendingDmgT += dt;
    if (fx.pendingDmgT >= 0.3 && fx.pendingDmg > 0) {
      const g = game.nearestEnemy();
      addDmgNum((g ? flipX(g.x) : 90) + (Math.random() - 0.5) * 30, groundY() - 70 - Math.random() * 20,
        fmt(fx.pendingDmg), '#fff', false);
      fx.pendingDmg = 0; fx.pendingDmgT = 0;
    }
    if (fx.flashT > 0) fx.flashT -= dt;
    if (fx.shake > 0) fx.shake = Math.max(0, fx.shake - dt * 20);

    render(ts / 1000, dt);
    requestAnimationFrame(loop);
  }

  function render(t, dt) {
    // 1) オフスクリーン低解像度canvasへシーン描画
    const s = offCanvas.width / view.w;
    ctx = offCtx;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.save();
    if (fx.shake > 0 && !REDUCED) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
    drawBackground();
    drawUnits(t);
    drawFx(dt);
    ctx.restore();
    // 2) メインcanvasへスムージングなしで拡大転送 (ドット絵化)
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.imageSmoothingEnabled = false;
    mainCtx.clearRect(0, 0, canvas.width, canvas.height);
    mainCtx.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);
  }

  // HUDは0.25秒ごとに更新
  setInterval(updateHud, 250);

  /* ---------- 起動 ---------- */
  // DotGothic16 を読み込んでから描画開始 (canvasテキストもドットフォント)
  const fontReady = (document.fonts && document.fonts.load)
    ? document.fonts.load('16px DotGothic16').catch(() => {})
    : Promise.resolve();
  Promise.all([loadAssets(), fontReady]).then(() => {
    resize();
    load();
    updateHud();
    // イントロ (§8): 開始時に1枚表示。ボタン/背景タップでスキップ可。
    el('intro-text').textContent = DATA.INTRO_TEXT;
    el('btn-start').addEventListener('click', () => {
      Audio2.init(); Audio2.resume(); Audio2.ui();
      el('title-screen').classList.add('hidden');
      el('modal-intro').hidden = false;
    });
    function closeIntro() {
      el('modal-intro').hidden = true;
      Audio2.ui();
      // 実機FB: イントロを閉じても建店シートは自動で開かない (バッジ/塔リストから手動で)
    }
    el('btn-close-intro').addEventListener('click', closeIntro);
    requestAnimationFrame(loop);
    // サービスワーカー
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  });
})();
