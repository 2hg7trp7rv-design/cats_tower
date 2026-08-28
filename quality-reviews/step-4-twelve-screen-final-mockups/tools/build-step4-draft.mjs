#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP3_ENTRY = '245d50b6e80e2783f6aeaab5e50fae217661a3b6';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const ACCEPTANCE = `${STEP4}/acceptance-matrix.json`;
const REGISTRY = 'canonical/SCREEN_STATE_REGISTRY.json';
const STEP3_LIVE = 'quality-reviews/step-3-large-scale-validation/live-readback.json';
const VIEWPORTS = [
  { id: 'compact', width: 320, height: 667, safeTop: 20, safeBottom: 16 },
  { id: 'standard', width: 375, height: 667, safeTop: 20, safeBottom: 16 },
  { id: 'expanded', width: 390, height: 844, safeTop: 47, safeBottom: 34 },
];

const PALETTE = {
  ink: '#0B1020',
  ink2: '#121A2D',
  ink3: '#1B2740',
  parchment: '#F5EBD3',
  parchment2: '#DCCDAA',
  gold: '#E7B95C',
  gold2: '#F5D895',
  jade: '#58C7A6',
  sky: '#78B9FF',
  ruby: '#E56B77',
  violet: '#A989E8',
  amber: '#F29B52',
  muted: '#9CA9C3',
  line: '#344461',
  white: '#FFFFFF',
  shadow: '#050712',
};

const SCREEN_META = {
  S01: { display: '旅の入口', subtitle: 'つづきから・アカウント', primary: '旅をつづける', nav: 'more', accent: PALETTE.gold, critical: 'LINK_CONFLICT', recovery: '競合した保存先を比較して選ぶ' },
  S02: { display: '塔の戦い', subtitle: '自動戦闘・追従', primary: '編成を整える', nav: 'battle', accent: PALETTE.jade, critical: 'BACKGROUND_RECONCILE', recovery: '帰還中の報酬を照合しています' },
  S03: { display: '無限の塔', subtitle: '現在階・次の節目', primary: '現在階へ戻る', nav: 'tower', accent: PALETTE.sky, critical: 'STALE_CACHE', recovery: '記録を更新して既知階を再表示' },
  S04: { display: '階層制圧', subtitle: '報酬・次の支援', primary: '選択を確定', nav: 'battle', accent: PALETTE.gold, critical: 'CLAIM_RECOVERY', recovery: '報酬結果を履歴から復元' },
  S05: { display: '商店と配送', subtitle: '戦闘支援を編成', primary: '配置を保存', nav: 'shop', accent: PALETTE.amber, critical: 'SYNC_CONFLICT', recovery: '新旧配置を比較して再適用' },
  S06: { display: '仲間', subtitle: 'レベル・進化・熟練', primary: '10レベル強化', nav: 'team', accent: PALETTE.ruby, critical: 'EVOLUTION_PENDING', recovery: '進化取引の結果を確認中' },
  S07: { display: '武器とビルド', subtitle: '装備・熟練・比較', primary: 'ムギに装備', nav: 'team', accent: PALETTE.violet, critical: 'EQUIP_CONFLICT', recovery: '別端末の装備変更を反映' },
  S08: { display: '地区ボス', subtitle: '予兆・ブレイク・再挑戦', primary: '戦闘へ戻る', nav: 'battle', accent: PALETTE.ruby, critical: 'RECONNECT', recovery: '決着前の戦闘記録へ再接続' },
  S09: { display: '塔還り', subtitle: '失う・残る・得る', primary: '内容を確認して塔還り', nav: 'tower', accent: PALETTE.gold2, critical: 'QUOTE_EXPIRED', recovery: '最新条件で見積りを更新' },
  S10: { display: '仲間を迎える', subtitle: 'キャラ・武器募集', primary: '10回迎える', nav: 'shop', accent: PALETTE.violet, critical: 'RESULT_RECOVERY', recovery: '抽選履歴から結果を復元' },
  S11: { display: 'ルビーと特典', subtitle: '有償・無料・広告', primary: '商品内容を確認', nav: 'shop', accent: PALETTE.gold, critical: 'PURCHASE_RECONCILIATION', recovery: '決済結果をストアと照合中' },
  S12: { display: 'ログインと便り', subtitle: '受取・受信箱・履歴', primary: '本日の贈り物を受取る', nav: 'more', accent: PALETTE.jade, critical: 'DUPLICATE_REQUEST', recovery: '二重受取せず履歴を再確認' },
};

const NAV = [
  { id: 'battle', label: '戦闘', icon: '⚔' },
  { id: 'tower', label: '塔', icon: '♜' },
  { id: 'team', label: '仲間', icon: '♟' },
  { id: 'shop', label: '商店', icon: '◆' },
  { id: 'more', label: 'その他', icon: '•••' },
];

function abs(relativePath) { return path.join(ROOT, relativePath); }
function readText(relativePath) { return readFileSync(abs(relativePath), 'utf8'); }
function readJson(relativePath) { return JSON.parse(readText(relativePath)); }
function ensureDir(relativePath) { mkdirSync(abs(relativePath), { recursive: true }); }
function writeText(relativePath, value) {
  ensureDir(path.dirname(relativePath));
  writeFileSync(abs(relativePath), `${String(value).replace(/[ \t]+$/gm, '').trim()}\n`, 'utf8');
}
function writeJson(relativePath, value) { writeText(relativePath, JSON.stringify(value, null, 2)); }
function sha256Buffer(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function sha256File(relativePath) { return sha256Buffer(readFileSync(abs(relativePath))); }
function git(...args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
function gitBlob(relativePath) { return git('rev-parse', `HEAD:${relativePath}`); }
function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function n(value) { return Number(value.toFixed(2)); }

function rect(x, y, width, height, fill, radius = 0, stroke = 'none', strokeWidth = 0, opacity = 1) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${n(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
}
function line(x1, y1, x2, y2, stroke, strokeWidth = 1, dash = '') {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}
function circle(cx, cy, r, fill, stroke = 'none', strokeWidth = 0, opacity = 1) {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
}
function text(x, y, value, size = 14, fill = PALETTE.white, weight = 500, anchor = 'start', family = 'system-ui, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif') {
  return `<text x="${n(x)}" y="${n(y)}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${family}" letter-spacing="0.01em">${esc(value)}</text>`;
}
function pathEl(d, fill, stroke = 'none', strokeWidth = 0, opacity = 1) {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round"/>`;
}
function progress(x, y, width, value, color, label, compact = false) {
  const h = compact ? 6 : 8;
  return `${label ? text(x, y - 5, label, compact ? 10 : 11, PALETTE.parchment2, 600) : ''}${rect(x, y, width, h, '#26334D', h / 2)}${rect(x, y, Math.max(h, width * value), h, color, h / 2)}`;
}
function chip(x, y, label, color = PALETTE.gold, width = null) {
  const w = width ?? Math.max(48, 16 + String(label).length * 10);
  return `${rect(x, y, w, 24, `${color}22`, 12, `${color}88`, 1)}${text(x + w / 2, y + 16, label, 10, color, 700, 'middle')}`;
}
function button(x, y, width, height, label, color, secondary = false) {
  const fill = secondary ? `${color}18` : color;
  const stroke = secondary ? color : `${color}CC`;
  const labelColor = secondary ? color : PALETTE.ink;
  return `<g filter="url(#shadow)">${rect(x, y, width, height, fill, Math.min(16, height / 2), stroke, 1.2)}${text(x + width / 2, y + height / 2 + 5, label, 14, labelColor, 800, 'middle')}</g>`;
}
function card(x, y, width, height, title, body, accent = PALETTE.gold, active = false) {
  const fill = active ? '#223252' : '#151F35';
  return `${rect(x, y, width, height, fill, 16, active ? accent : PALETTE.line, active ? 1.5 : 1)}${rect(x, y, 4, height, accent, 2)}${text(x + 14, y + 23, title, 12, PALETTE.parchment, 800)}${body ? text(x + 14, y + 43, body, 10, PALETTE.muted, 500) : ''}`;
}
function catAvatar(cx, cy, r, color, label = '', mood = 'calm') {
  const ear = r * 0.72;
  const eyeY = cy - r * 0.02;
  const eyeOffset = r * 0.32;
  const eye = mood === 'focus' ? 1.6 : 2.1;
  return `<g filter="url(#soft)">${pathEl(`M ${n(cx-r*0.74)} ${n(cy-r*0.55)} L ${n(cx-r*0.68)} ${n(cy-ear*1.2)} L ${n(cx-r*0.16)} ${n(cy-r*0.77)} L ${n(cx+r*0.16)} ${n(cy-r*0.77)} L ${n(cx+r*0.68)} ${n(cy-ear*1.2)} L ${n(cx+r*0.74)} ${n(cy-r*0.55)} Z`, color)}${circle(cx, cy, r, color)}${circle(cx-eyeOffset, eyeY, eye, PALETTE.ink)}${circle(cx+eyeOffset, eyeY, eye, PALETTE.ink)}${pathEl(`M ${n(cx-r*0.08)} ${n(cy+r*0.12)} L ${n(cx)} ${n(cy+r*0.2)} L ${n(cx+r*0.08)} ${n(cy+r*0.12)}`, 'none', PALETTE.ink, 1.4)}${label ? text(cx, cy + r + 14, label, 9, PALETTE.parchment2, 700, 'middle') : ''}</g>`;
}
function weaponIcon(cx, cy, scale, color = PALETTE.gold) {
  return `<g transform="translate(${n(cx)} ${n(cy)}) rotate(-35)">${rect(-3 * scale, -32 * scale, 6 * scale, 45 * scale, color, 3 * scale)}${pathEl(`M ${-8*scale} ${-35*scale} L 0 ${-48*scale} L ${8*scale} ${-35*scale} Z`, PALETTE.gold2)}${rect(-12*scale, 10*scale, 24*scale, 4*scale, PALETTE.parchment2, 2*scale)}${circle(0, 20*scale, 5*scale, PALETTE.ruby)}</g>`;
}
function header(width, safeTop, meta, screenId) {
  const compact = width <= 320;
  return `<g>${text(16, safeTop + 21, meta.display, compact ? 17 : 19, PALETTE.parchment, 850)}${text(16, safeTop + 39, meta.subtitle, 10, PALETTE.muted, 600)}${chip(width - (compact ? 82 : 92), safeTop + 7, screenId, meta.accent, compact ? 66 : 74)}</g>`;
}
function topHud(width, y, compact = false) {
  const gap = compact ? 6 : 8;
  const cell = (width - 32 - gap * 2) / 3;
  const data = [
    ['階', '127F', PALETTE.sky],
    ['コイン', '8.42M', PALETTE.gold],
    ['ルビー', '1,280', PALETTE.ruby],
  ];
  return data.map((item, index) => {
    const x = 16 + index * (cell + gap);
    return `${rect(x, y, cell, compact ? 38 : 42, '#141E33CC', 12, PALETTE.line, 1)}${text(x + 10, y + 14, item[0], 8, PALETTE.muted, 700)}${text(x + 10, y + (compact ? 30 : 33), item[1], compact ? 12 : 13, item[2], 850)}`;
  }).join('');
}
function recoveryPanel(width, y, meta, compact = false) {
  const h = compact ? 48 : 54;
  return `${rect(16, y, width - 32, h, '#261A29', 14, `${PALETTE.ruby}99`, 1)}${circle(31, y + 17, 5, PALETTE.ruby)}${text(43, y + 18, meta.critical, compact ? 9 : 10, PALETTE.ruby, 850)}${text(30, y + 37, meta.recovery, compact ? 9 : 10, PALETTE.parchment2, 600)}${text(width - 27, y + 32, '›', 20, PALETTE.ruby, 800, 'middle')}`;
}
function navBar(width, height, safeBottom, active) {
  const y = height - safeBottom - 68;
  const cell = width / NAV.length;
  return `${rect(0, y, width, 68 + safeBottom, '#0A0F1DEB', 0, '#273653', 1)}${NAV.map((item, index) => {
    const cx = cell * index + cell / 2;
    const selected = item.id === active;
    return `${selected ? rect(cx - cell * 0.34, y + 6, cell * 0.68, 48, `${PALETTE.gold}16`, 14) : ''}${text(cx, y + 26, item.icon, item.id === 'more' ? 14 : 17, selected ? PALETTE.gold : PALETTE.muted, 800, 'middle')}${text(cx, y + 46, item.label, 9, selected ? PALETTE.gold2 : PALETTE.muted, selected ? 800 : 600, 'middle')}`;
  }).join('')}</g>`;
}

function battleScene(width, y, height, boss = false) {
  const fieldW = width - 32;
  const groundY = y + height - 33;
  const enemyX = width - 70;
  return `<g>${rect(16, y, fieldW, height, 'url(#field)', 18, PALETTE.line, 1)}${pathEl(`M 16 ${groundY} C ${width*0.25} ${groundY-10}, ${width*0.52} ${groundY+5}, ${width-16} ${groundY-8} L ${width-16} ${y+height} L 16 ${y+height} Z`, '#19233A')}${boss ? `${circle(enemyX, groundY-58, 38, '#4E273C', PALETTE.ruby, 2)}${pathEl(`M ${enemyX-34} ${groundY-76} L ${enemyX-46} ${groundY-112} L ${enemyX-12} ${groundY-92} M ${enemyX+34} ${groundY-76} L ${enemyX+46} ${groundY-112} L ${enemyX+12} ${groundY-92}`, 'none', PALETTE.ruby, 8)}${text(enemyX, groundY-52, '影翼', 13, PALETTE.parchment, 850, 'middle')}` : `${circle(enemyX, groundY-37, 27, '#32435F', PALETTE.sky, 1.5)}${text(enemyX, groundY-33, '敵', 12, PALETTE.parchment, 800, 'middle')}`}${catAvatar(58, groundY-32, 18, '#D49B59', 'ムギ', 'focus')}${catAvatar(101, groundY-42, 15, '#B7A5E8', 'ルナ')}${catAvatar(140, groundY-29, 16, '#E7C97D', 'トト')}${catAvatar(179, groundY-37, 15, '#85B4A4', 'コハク')}${line(199, groundY-37, enemyX-28, groundY-37, PALETTE.gold, 2, '5 5')}${circle(218, groundY-37, 4, PALETTE.gold2)}${progress(width-126, y+16, 94, boss ? 0.62 : 0.38, boss ? PALETTE.ruby : PALETTE.sky, boss ? 'BOSS HP' : 'WAVE HP', true)}</g>`;
}

function screenBody(id, width, height, top, bottom, meta) {
  const compact = width <= 320;
  const expanded = height >= 800;
  const contentH = bottom - top;
  const innerW = width - 32;
  const mid = width / 2;
  let out = '';

  if (id === 'S01') {
    const towerTop = top + 22;
    out += rect(16, top, innerW, contentH - 8, 'url(#hero)', 22, PALETTE.line, 1);
    out += circle(width - 62, towerTop + 26, 28, '#F4DDA2', 'none', 0, 0.9);
    out += pathEl(`M ${mid-38} ${towerTop+174} L ${mid-28} ${towerTop+78} L ${mid-13} ${towerTop+78} L ${mid-8} ${towerTop+42} L ${mid+8} ${towerTop+42} L ${mid+13} ${towerTop+78} L ${mid+28} ${towerTop+78} L ${mid+38} ${towerTop+174} Z`, '#202C49', PALETTE.gold, 1.5);
    out += [mid-54, mid-18, mid+18, mid+54].map((x, i) => catAvatar(x, towerTop + 190, compact ? 14 : 16, ['#D49B59','#B7A5E8','#E7C97D','#85B4A4'][i])).join('');
    out += text(mid, towerTop + 224, '猫たちと、終わりのない塔へ。', compact ? 13 : 15, PALETTE.parchment, 800, 'middle');
    out += text(mid, towerTop + 244, '保存データはサーバーと同期済み', 10, PALETTE.jade, 650, 'middle');
    const buttonY = top + contentH - (expanded ? 150 : 136);
    out += button(32, buttonY, width - 64, 48, '旅をつづける', meta.accent);
    out += button(32, buttonY + 58, width - 64, 42, 'はじめから', PALETTE.sky, true);
  }

  if (id === 'S02') {
    out += topHud(width, top, compact);
    out += battleScene(width, top + (compact ? 48 : 52), expanded ? 292 : 230, false);
    const y = top + (expanded ? 354 : 294);
    out += card(16, y, innerW, 70, '自動戦闘中', '配送支援まで 00:08　・　撃破 6/10', PALETTE.jade, true);
    if (expanded) {
      const cell = (innerW - 18) / 4;
      out += ['挑発','対空','回復','妨害'].map((label, i) => `${rect(16+i*(cell+6), y+80, cell, 54, '#16223A', 14, PALETTE.line, 1)}${text(16+i*(cell+6)+cell/2, y+102, label, 10, PALETTE.parchment, 750, 'middle')}${progress(22+i*(cell+6), y+116, cell-12, 0.25+i*0.18, [PALETTE.gold,PALETTE.sky,PALETTE.jade,PALETTE.violet][i], '', true)}`).join('');
    }
  }

  if (id === 'S03') {
    out += topHud(width, top, compact);
    const mapY = top + (compact ? 50 : 56);
    out += rect(16, mapY, innerW, contentH - (compact ? 58 : 64), 'url(#towerMap)', 18, PALETTE.line, 1);
    const nodes = expanded ? [100,110,120,127,130,140,150] : [110,120,127,130,140];
    const span = (contentH - 130) / Math.max(1, nodes.length - 1);
    nodes.forEach((floor, i) => {
      const cy = mapY + 34 + i * span;
      const current = floor === 127;
      out += line(mid, cy - (i ? span : 0), mid, cy, current ? PALETTE.gold : PALETTE.line, current ? 3 : 2, i ? '4 5' : '');
      out += circle(mid, cy, current ? 13 : 9, current ? PALETTE.gold : '#263752', current ? PALETTE.gold2 : PALETTE.line, 2);
      out += text(mid + 24, cy + 4, `${floor}F`, current ? 14 : 12, current ? PALETTE.gold2 : PALETTE.parchment2, current ? 850 : 650);
      if (floor === 100 || floor === 150) out += chip(28, cy - 12, floor === 100 ? '節目達成' : '次の節目', floor === 100 ? PALETTE.jade : PALETTE.sky, 70);
    });
  }

  if (id === 'S04') {
    out += rect(16, top, innerW, 74, 'url(#reward)', 18, PALETTE.gold, 1.2);
    out += text(30, top + 28, '127F 制圧', 17, PALETTE.parchment, 900);
    out += text(30, top + 51, '+ 82,400 コイン　+ 武器券 2', 11, PALETTE.gold2, 750);
    const y = top + 88;
    out += text(16, y, '次の階へ持ち込む支援', 12, PALETTE.parchment, 800);
    const choices = [
      ['前線鍛冶', '全攻撃 +8%', PALETTE.ruby],
      ['月灯り便', '配送速度 +12%', PALETTE.sky],
      ['猫宿の膳', '回復量 +10%', PALETTE.jade],
    ];
    const ch = compact ? 64 : 72;
    choices.forEach((c, i) => { out += card(16, y + 12 + i * (ch + 8), innerW, ch, c[0], c[1], c[2], i === 1); });
    const by = y + 12 + choices.length * (ch + 8) + 4;
    out += button(16, by, innerW, 46, '月灯り便を選ぶ', PALETTE.sky);
    out += text(mid, by + 65, 'あとで決める', 11, PALETTE.muted, 700, 'middle');
  }

  if (id === 'S05') {
    out += rect(16, top, innerW, expanded ? 244 : 196, 'url(#shop)', 18, PALETTE.line, 1);
    const shopW = (innerW - 32) / 2;
    const shopY = top + 35;
    [['鍛冶工房','攻撃 +8%',PALETTE.ruby],['猫宿','回復 +10%',PALETTE.jade],['配送所','到着 -12%',PALETTE.sky],['空き区画','配置する',PALETTE.gold]].forEach((s,i)=>{
      const x = 26 + (i%2)*(shopW+12);
      const y = shopY + Math.floor(i/2)*(expanded?88:72);
      out += `${rect(x,y,shopW,expanded?74:60,'#192640',14,s[2],1)}${text(x+12,y+22,s[0],11,PALETTE.parchment,800)}${text(x+12,y+43,s[1],10,s[2],700)}${pathEl(`M ${x+shopW-30} ${y+42} L ${x+shopW-16} ${y+27} L ${x+shopW-8} ${y+42} Z`,s[2])}`;
    });
    const qy = top + (expanded ? 258 : 210);
    out += card(16, qy, innerW, 70, '配送キュー', '00:08 攻撃便　→　00:23 回復便', PALETTE.sky, true);
    out += card(16, qy + 80, innerW, 66, '戦闘への予測効果', '次の10階: 約 1分42秒短縮', PALETTE.gold);
  }

  if (id === 'S06') {
    const portraitH = expanded ? 236 : 182;
    out += rect(16, top, innerW, portraitH, 'url(#portrait)', 20, PALETTE.line, 1);
    out += catAvatar(mid, top + (expanded ? 104 : 80), expanded ? 58 : 44, '#D49B59', 'ムギ', 'focus');
    out += chip(28, top + 18, 'N', PALETTE.parchment2, 38);
    out += chip(width - 106, top + 18, '前衛・制御', PALETTE.ruby, 78);
    out += text(mid, top + portraitH - 26, 'Lv. 12,480', expanded ? 21 : 18, PALETTE.gold2, 900, 'middle');
    const y = top + portraitH + 12;
    out += progress(16, y + 18, innerW, 0.72, PALETTE.gold, '次の10レベル');
    out += progress(16, y + 55, innerW, 0.36, PALETTE.ruby, '進化資格 12 / 20');
    out += progress(16, y + 92, innerW, 0.55, PALETTE.violet, '熟練 11 / 20');
    if (expanded) {
      out += card(16, y + 118, innerW, 68, '進化プレビュー', '役割は変えず、挑発時間と防御演出を強化', PALETTE.ruby);
    }
  }

  if (id === 'S07') {
    const heroH = expanded ? 226 : 176;
    out += rect(16, top, innerW, heroH, 'url(#weapon)', 20, PALETTE.violet, 1);
    out += weaponIcon(mid, top + heroH/2 + 6, expanded ? 1.35 : 1.05, PALETTE.violet);
    out += chip(28, top + 18, 'SSR', PALETTE.violet, 48);
    out += text(mid, top + heroH - 24, '星渡りの短剣', 16, PALETTE.parchment, 900, 'middle');
    const y = top + heroH + 12;
    out += card(16, y, innerW, 58, '装備中', 'コハク　・　熟練 7 / 20', PALETTE.violet, true);
    out += text(16, y + 82, 'ビルド比較', 12, PALETTE.parchment, 800);
    const rows = [['戦闘',0.82,PALETTE.ruby],['増援',0.58,PALETTE.jade],['商業',0.41,PALETTE.gold]];
    rows.forEach((r,i)=>{ out += text(16,y+105+i*31,r[0],10,PALETTE.muted,700); out += progress(62,y+97+i*31,innerW-46,r[1],r[2],'',true); });
    if (expanded) out += card(16, y + 198, innerW, 64, '敗北診断との相性', '後衛妨害は改善。対空はルナの装備を優先。', PALETTE.sky);
  }

  if (id === 'S08') {
    out += battleScene(width, top, expanded ? 310 : 242, true);
    const y = top + (expanded ? 322 : 254);
    out += progress(16, y + 12, innerW, 0.71, PALETTE.ruby, 'PHASE 2 / 3');
    out += progress(16, y + 49, innerW, 0.46, PALETTE.gold, 'BREAK');
    out += card(16, y + 72, innerW, 68, '危険行動：月影の急降下', '赤い扇形の外へ移動。残り 2.4秒', PALETTE.ruby, true);
    if (expanded) out += card(16, y + 150, innerW, 66, '失敗時に分かること', '前衛崩壊・回復不足・配送遅延を個別表示', PALETTE.sky);
  }

  if (id === 'S09') {
    out += rect(16, top, innerW, 72, 'url(#return)', 18, PALETTE.gold, 1);
    out += text(30, top + 28, '塔還り 見積り', 17, PALETTE.parchment, 900);
    out += text(30, top + 51, '見積りID QT-7F2A　有効 04:36', 10, PALETTE.muted, 650);
    const y = top + 86;
    const colGap = 6;
    const colW = (innerW - colGap * 2) / 3;
    [['失う','階・今周コイン',PALETTE.ruby],['残る','仲間・店設定',PALETTE.jade],['得る','ルビー 420',PALETTE.gold]].forEach((c,i)=>{
      const x=16+i*(colW+colGap);
      out += `${rect(x,y,colW,92,'#172239',14,c[2],1)}${text(x+colW/2,y+25,c[0],11,c[2],850,'middle')}${text(x+colW/2,y+49,c[1],compact?8:9,PALETTE.parchment2,650,'middle')}${i===2?text(x+colW/2,y+75,'新記録分',9,PALETTE.gold2,700,'middle'):''}`;
    });
    out += card(16, y + 104, innerW, 72, '再攻略予測', '127Fまで 18分 → 6分20秒', PALETTE.sky, true);
    out += card(16, y + 186, innerW, 64, '反復保護', '同じ最高階では新しい塔還りルビー 0', PALETTE.ruby);
    if (expanded) out += button(16, y + 262, innerW, 48, '内容を確認して塔還り', PALETTE.gold);
  }

  if (id === 'S10') {
    out += `${chip(16,top,'キャラクター',PALETTE.violet,94)}${chip(116,top,'武器',PALETTE.sky,58)}`;
    const bannerY = top + 36;
    out += rect(16, bannerY, innerW, expanded ? 216 : 168, 'url(#gacha)', 20, PALETTE.violet, 1.2);
    out += catAvatar(mid - 48, bannerY + (expanded ? 96 : 75), expanded ? 40 : 32, '#C8B5FA');
    out += catAvatar(mid + 48, bannerY + (expanded ? 96 : 75), expanded ? 40 : 32, '#85B4A4');
    out += text(mid, bannerY + (expanded ? 169 : 133), '月影の旅団', 18, PALETTE.parchment, 900, 'middle');
    out += text(mid, bannerY + (expanded ? 191 : 153), '初回入手で基本スキル解放', 10, PALETTE.gold2, 700, 'middle');
    const y = bannerY + (expanded ? 230 : 182);
    out += progress(16,y+14,innerW,0.67,PALETTE.violet,'ハード保証 67 / 100');
    out += progress(16,y+51,innerW,0.34,PALETTE.gold,'注目保証 67 / 200');
    out += card(16,y+70,innerW,58,'提供割合・交換・履歴','UR 3.0%　・　交換 122 / 200',PALETTE.sky);
    if (expanded) out += button(16,y+140,innerW,48,'募集券10枚で迎える',PALETTE.violet);
  }

  if (id === 'S11') {
    out += rect(16, top, innerW, 92, 'url(#wallet)', 18, PALETTE.gold, 1);
    out += text(30, top + 26, 'ルビー残高', 13, PALETTE.parchment, 850);
    const ledger = [['有償','320',PALETTE.gold],['塔還り','540',PALETTE.sky],['広告','120',PALETTE.jade],['その他','300',PALETTE.violet]];
    const lw=(innerW-24)/4;
    ledger.forEach((l,i)=>{ const x=28+i*lw; out += text(x,top+52,l[0],8,PALETTE.muted,700); out += text(x,top+73,l[1],12,l[2],850); });
    const y=top+106;
    out += text(16,y,'おすすめではなく、内容で選ぶ',11,PALETTE.parchment2,750);
    out += card(16,y+12,innerW,68,'月灯り便 30日','毎日募集券・速度上限 約1.8倍',PALETTE.gold,true);
    out += card(16,y+90,innerW,68,'ルビー 1,200','有償 1,200　・　購入前に内訳表示',PALETTE.ruby);
    out += card(16,y+168,innerW,68,'任意の報酬広告','募集券 5枚　・　本日 1 / 4',PALETTE.jade);
    if (expanded) out += card(16,y+246,innerW,64,'返金差額の表示','他の無料ルビーを黙って差し引かない',PALETTE.ruby);
  }

  if (id === 'S12') {
    out += `${chip(16,top,'新米',PALETTE.jade,54)}${chip(76,top,'月間',PALETTE.sky,54)}${chip(136,top,'復帰',PALETTE.gold,54)}`;
    const calY=top+36;
    out += rect(16,calY,innerW,expanded?254:198,'#151F35',18,PALETTE.line,1);
    out += text(30,calY+28,'霜月の贈り物',15,PALETTE.parchment,850);
    const cols=7;
    const cell=(innerW-28)/cols;
    const rows=expanded?4:3;
    for(let row=0;row<rows;row++) for(let col=0;col<cols;col++){
      const day=row*cols+col+1;
      const cx=30+col*cell+cell/2;
      const cy=calY+56+row*(expanded?43:40);
      const today=day===8;
      out += circle(cx,cy,compact?12:14,today?PALETTE.jade:(day<8?'#263C45':'#202B42'),today?PALETTE.parchment:'none',today?1.5:0);
      out += text(cx,cy+4,String(day),8,today?PALETTE.ink:PALETTE.parchment2,750,'middle');
    }
    const y=calY+(expanded?270:214);
    out += card(16,y,innerW,64,'本日の贈り物','募集券 10枚　・　サーバー時刻で判定',PALETTE.jade,true);
    out += card(16,y+74,innerW,64,'受信箱 3件','期限・送信元・受取履歴を表示',PALETTE.sky);
    if(expanded) out += card(16,y+148,innerW,58,'受取履歴','重複要求は追加付与せず履歴へ収束',PALETTE.gold);
  }

  return out;
}

function renderScreen(screen, viewport) {
  const { width, height, safeTop, safeBottom } = viewport;
  const meta = SCREEN_META[screen.id];
  const compact = width <= 320;
  const headerH = 56;
  const navTop = height - safeBottom - 68;
  const recoveryH = compact ? 48 : 54;
  const recoveryY = navTop - recoveryH - 8;
  const bodyTop = safeTop + headerH;
  const bodyBottom = recoveryY - 8;
  const title = `${screen.id} ${meta.display} ${viewport.width}x${viewport.height}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title>
<desc id="desc">Cat's Tower Step 4 final mockup draft. ${esc(screen.name)} normal state with ${esc(meta.critical)} recovery state.</desc>
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111B30"/><stop offset="1" stop-color="#080C18"/></linearGradient>
  <linearGradient id="field" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#233352"/><stop offset="0.55" stop-color="#18263F"/><stop offset="1" stop-color="#30223E"/></linearGradient>
  <linearGradient id="hero" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#253457"/><stop offset="0.58" stop-color="#151E34"/><stop offset="1" stop-color="#311F38"/></linearGradient>
  <linearGradient id="towerMap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#13233F"/><stop offset="1" stop-color="#241C35"/></linearGradient>
  <linearGradient id="reward" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4A3823"/><stop offset="1" stop-color="#1C2843"/></linearGradient>
  <linearGradient id="shop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#302A28"/><stop offset="1" stop-color="#17263E"/></linearGradient>
  <linearGradient id="portrait" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#382A34"/><stop offset="0.55" stop-color="#263754"/><stop offset="1" stop-color="#122238"/></linearGradient>
  <linearGradient id="weapon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2B2345"/><stop offset="1" stop-color="#17243C"/></linearGradient>
  <linearGradient id="return" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4A3927"/><stop offset="1" stop-color="#17243B"/></linearGradient>
  <linearGradient id="gacha" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B2A58"/><stop offset="0.5" stop-color="#1E2E4B"/><stop offset="1" stop-color="#392638"/></linearGradient>
  <linearGradient id="wallet" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#40341F"/><stop offset="1" stop-color="#1A2944"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#03050B" flood-opacity="0.42"/></filter>
  <filter id="soft" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#050712" flood-opacity="0.3"/></filter>
  <pattern id="stars" width="38" height="38" patternUnits="userSpaceOnUse"><circle cx="6" cy="7" r="0.8" fill="#F5D895" opacity="0.34"/><circle cx="29" cy="24" r="0.6" fill="#78B9FF" opacity="0.28"/></pattern>
</defs>
${rect(0,0,width,height,'url(#bg)')}${rect(0,0,width,height,'url(#stars)')}${header(width,safeTop,meta,screen.id)}${screenBody(screen.id,width,height,bodyTop,bodyBottom,meta)}${recoveryPanel(width,recoveryY,meta,compact)}${navBar(width,height,safeBottom,meta.nav)}
</svg>`;
}

function galleryHtml(screens) {
  const screenOptions = screens.map((screen) => `<button class="screen-tab" data-screen="${screen.id}" aria-controls="stage">${screen.id}<span>${esc(SCREEN_META[screen.id].display)}</span></button>`).join('');
  const cards = screens.map((screen) => `<article class="screen-card" data-screen-card="${screen.id}"><header><strong>${screen.id} ${esc(SCREEN_META[screen.id].display)}</strong><small>${esc(screen.name)}</small></header><div class="render-grid">${VIEWPORTS.map((viewport) => `<figure data-viewport="${viewport.id}"><img src="./mockups/${screen.id}-${viewport.width}x${viewport.height}.svg" width="${viewport.width}" height="${viewport.height}" alt="${screen.id} ${esc(SCREEN_META[screen.id].display)} ${viewport.width}x${viewport.height}"><figcaption>${viewport.width}×${viewport.height}</figcaption></figure>`).join('')}</div></article>`).join('');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Cat's Tower Step 4 — 12画面完成見本 Draft</title>
<style>
:root{color-scheme:dark;--ink:#0B1020;--surface:#121A2D;--surface2:#1B2740;--line:#344461;--paper:#F5EBD3;--muted:#9CA9C3;--gold:#E7B95C;--focus:#78B9FF;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#243552 0,#0b1020 42%,#060912 100%);color:var(--paper);min-height:100vh}header.page{padding:max(28px,env(safe-area-inset-top)) 20px 20px;max-width:1440px;margin:auto}.eyebrow{color:var(--gold);font-size:12px;font-weight:800;letter-spacing:.16em}.page h1{font-size:clamp(26px,5vw,48px);margin:.35rem 0}.page p{color:var(--muted);max-width:76ch;line-height:1.75}.controls{position:sticky;top:0;z-index:5;background:#090e1bea;border-block:1px solid var(--line);backdrop-filter:blur(18px);padding:10px 14px}.screen-tabs{display:flex;gap:8px;overflow:auto;max-width:1440px;margin:auto;padding-bottom:3px}.screen-tab{border:1px solid var(--line);background:var(--surface);color:var(--paper);border-radius:13px;min-width:92px;padding:8px 10px;text-align:left;cursor:pointer}.screen-tab span{display:block;color:var(--muted);font-size:10px;margin-top:2px}.screen-tab[aria-selected="true"]{border-color:var(--gold);box-shadow:0 0 0 2px #e7b95c22;background:#2b2a31}.gallery{max-width:1440px;margin:auto;padding:20px;display:grid;gap:26px}.screen-card{display:none;background:#0e1525d9;border:1px solid var(--line);border-radius:24px;padding:18px;box-shadow:0 24px 70px #0008}.screen-card.active{display:block}.screen-card>header{display:flex;gap:12px;align-items:baseline;margin-bottom:16px}.screen-card small{color:var(--muted)}.render-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;align-items:start}.render-grid figure{margin:0;display:grid;justify-items:center;gap:8px}.render-grid img{display:block;max-width:100%;height:auto;border-radius:28px;box-shadow:0 22px 55px #000a;border:1px solid #ffffff1a;background:#090d17}.render-grid figcaption{font-size:11px;color:var(--muted)}.legend{max-width:1440px;margin:0 auto;padding:0 20px 48px;color:var(--muted);line-height:1.7}.legend strong{color:var(--paper)}button:focus-visible{outline:3px solid var(--focus);outline-offset:3px}@media(max-width:900px){.render-grid{grid-template-columns:1fr}.render-grid img{width:min(100%,390px)}.screen-tab{min-width:76px}.screen-tab span{display:none}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
</style>
</head>
<body>
<header class="page"><div class="eyebrow">STEP 4 · FINAL MOCKUP DRAFT</div><h1>Cat's Tower — 12画面完成見本</h1><p>Step 3で封印したゲーム経済と状態契約を、スマートフォン縦画面の情報設計へ変換した検証用ギャラリーです。各画面は正常状態に加え、最も重要なpending／recovery状態を同一画面内に示します。これは製品runtimeではありません。</p></header>
<nav class="controls" aria-label="画面選択"><div class="screen-tabs">${screenOptions}</div></nav>
<main id="stage" class="gallery">${cards}</main>
<section class="legend"><strong>検証範囲:</strong> 320×667 / 375×667 / 390×844、safe area、44px以上の主要操作、large textを想定した階層、reduced motion、server-authoritative経済状態。<br><strong>未検証:</strong> 物理iPhone、実ゲーム操作感、最終アニメーション、Production、provider接続。</section>
<script>
const tabs=[...document.querySelectorAll('.screen-tab')];const cards=[...document.querySelectorAll('.screen-card')];function select(id){tabs.forEach(t=>t.setAttribute('aria-selected',String(t.dataset.screen===id)));cards.forEach(c=>c.classList.toggle('active',c.dataset.screenCard===id));history.replaceState(null,'','#'+id)}tabs.forEach(t=>t.addEventListener('click',()=>select(t.dataset.screen)));select(location.hash.slice(1)||'S01');
</script>
</body>
</html>`;
}

function classifyState(value) {
  if (/READY|TUTORIAL|INTRO|RESULT|GRANTED|RESTORED|RECOVERED|COMPLETED|REWARD_CONFIRMED|ODDS_VIEW|BREAK/.test(value)) return 'resolved-or-normal';
  if (/LOADING|PENDING|CONFIRMING|QUOTE_LOADING|DRAW_PENDING|CLAIM_PENDING|SAVE_PENDING|RESTORE_PENDING|DELETION_PENDING|VICTORY_PENDING|SETTLEMENT_PENDING/.test(value)) return 'pending';
  if (/OFFLINE|RECONNECT|RETRYABLE|DESYNC|STALE|CONFLICT|RECOVERY|EXPIRED|DUPLICATE|ALREADY|SERVER_TIME_ERROR|VERIFICATION_FAILED|BACKGROUND_RECONCILE/.test(value)) return 'recovery-or-reconciliation';
  if (/INSUFFICIENT|INELIGIBLE|NOT_ELIGIBLE|REVOKED|DELETED|FATAL|MAINTENANCE|CAP_REACHED|BANNER_ENDED|DEFEAT/.test(value)) return 'blocked-or-terminal';
  return 'contextual';
}

function main() {
  assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
  assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(git('replace', '-l'), '');
  execFileSync('git', ['merge-base', '--is-ancestor', STEP3_ENTRY, 'HEAD'], { cwd: ROOT });

  const acceptance = readJson(ACCEPTANCE);
  const registry = readJson(REGISTRY);
  const step3Live = readJson(STEP3_LIVE);
  assert.equal(registry.screenCount, 12);
  assert.deepEqual(registry.globalRules.screenIds, Object.keys(SCREEN_META));
  assert.equal(step3Live.governanceDecision.step3, 'PASS');
  assert.equal(step3Live.governanceDecision.step4, 'READY_TO_START');
  assert.equal(step3Live.scopeReadback.productionAliasChanged, false);
  assert.equal(step3Live.scopeReadback.physicalIPhoneVerified, false);

  ensureDir(`${STEP4}/mockups`);
  ensureDir(`${STEP4}/tools`);

  const referenceAudit = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-reference-audit-v1',
    recordedAt: new Date().toISOString(),
    repository: REPOSITORY,
    branch: BRANCH,
    referenceSet: {
      source: 'user-provided conversation images',
      itemCount: 20,
      redistribution: false,
      byteCopiesCommitted: false,
      purpose: 'principle-level visual audit only; no tracing or UI cloning',
    },
    adoptedPrinciples: [
      'portrait-first one-thumb hierarchy with a stable contextual action zone',
      'character and battle scene receive the largest visual area before stores or banners',
      'rarity and reward information use redundant color, label and icon encoding',
      'foreground cards separate actionable state from atmospheric scene art',
      'strong single primary action per state and restrained secondary actions',
      'layered fantasy depth using night ink, parchment, warm metal and restrained jewel accents',
      'bottom navigation remains stable while economic operations move into dedicated screens',
    ],
    rejectedPrinciples: [
      'copying any reference layout, wording, icon, character, frame or decorative motif one-to-one',
      'permanent gacha, store or ad buttons occupying the battle focal area',
      'more than three currencies in the compact battle HUD',
      'tiny dense text, unlabeled rarity color, or color-only warnings',
      'red notification dots used as generalized pressure rather than actionable state',
      'tap-damage or mandatory rapid-tap affordances',
      'motion-only telegraphs, uncontrolled particles, or pulsing monetization CTAs',
    ],
    originalDirection: {
      name: 'Lantern and Velvet',
      statement: 'Moonlit tower adventure with tactile parchment cards and restrained jewel accents; cats, combat and progression remain the visual protagonists.',
      copyrightBoundary: 'Original vector geometry and system UI only. Reference imagery is not embedded, traced or redistributed.',
    },
    verdict: 'PASS_REFERENCE_PRINCIPLE_AUDIT_READY_FOR_ORIGINAL_MOCKUPS',
  };
  writeJson(`${STEP4}/reference-audit.json`, referenceAudit);

  const designSystem = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-design-system-v1',
    direction: referenceAudit.originalDirection,
    tokens: {
      color: PALETTE,
      spacing: { unit: 4, scale: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64] },
      radius: { chip: 12, control: 14, card: 16, hero: 20, device: 28 },
      elevation: { card: '0 8px 24px rgba(0,0,0,.24)', modal: '0 24px 70px rgba(0,0,0,.52)' },
      typography: {
        family: 'system-ui, -apple-system, BlinkMacSystemFont, Hiragino Sans, Noto Sans JP, sans-serif',
        display: { size: 24, weight: 900, lineHeight: 1.18 },
        heading: { size: 19, weight: 850, lineHeight: 1.25 },
        body: { size: 14, weight: 500, lineHeight: 1.55 },
        caption: { size: 10, weight: 650, lineHeight: 1.4 },
        minimumRuntimeBodyTarget: 14,
      },
    },
    responsive: {
      viewports: VIEWPORTS,
      rules: [
        '320x667 compresses secondary labels before shrinking primary controls',
        '375x667 is the standard density reference',
        '390x844 exposes secondary diagnosis and forecast cards',
        'top and bottom safe areas are reserved; no primary action intersects them',
        'bottom navigation remains five destinations with labels',
      ],
    },
    interaction: {
      minimumTouchTarget: 44,
      preferredPrimaryTarget: 48,
      onePrimaryActionPerState: true,
      destructiveConfirmationSeparated: true,
      economicTimeoutMeansFailure: false,
      pendingAndReconciliationVisible: true,
    },
    accessibility: {
      colorOnlyEncodingForbidden: true,
      largeTextStrategy: 'wrap or reduce secondary copy; never clip amounts, outcome, or primary action',
      reducedMotion: 'disable parallax, shake, looping pulse and particles; retain shape, label and progress evidence',
      contrastTarget: 'WCAG AA for body and critical state labels where technically applicable',
      focusVisible: true,
    },
    motion: {
      normalDurationMs: [120, 180, 240],
      reducedMotionDurationMs: 0,
      battleTelegraphRedundancy: ['shape', 'label', 'countdown', 'contrast'],
      monetizationPulseAllowed: false,
    },
    visualHierarchy: ['world and character', 'current objective and outcome', 'contextual primary action', 'secondary systems', 'monetization only in dedicated surfaces'],
    verdict: 'PASS_STEP4_DESIGN_SYSTEM_DRAFT',
  };
  writeJson(`${STEP4}/design-system.json`, designSystem);

  const screenSpecs = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-screen-specs-v1',
    sourceRegistry: { path: REGISTRY, blob: gitBlob(REGISTRY), screenCount: registry.screenCount },
    screens: registry.screens.map((screen) => ({
      id: screen.id,
      canonicalName: screen.name,
      displayName: SCREEN_META[screen.id].display,
      subtitle: SCREEN_META[screen.id].subtitle,
      primaryAction: SCREEN_META[screen.id].primary,
      primaryNavigation: SCREEN_META[screen.id].nav,
      responsibilities: screen.responsibilities,
      authority: screen.authority,
      requiredState: screen.requiredState,
      serverOwnedState: screen.serverOwnedState,
      canonicalUiStates: screen.uiStates,
      stateGroups: Object.fromEntries(['resolved-or-normal','pending','recovery-or-reconciliation','blocked-or-terminal','contextual'].map((group) => [group, screen.uiStates.filter((state) => classifyState(state) === group)])),
      showcasedCriticalState: SCREEN_META[screen.id].critical,
      showcasedRecoveryAction: SCREEN_META[screen.id].recovery,
      viewportFiles: VIEWPORTS.map((viewport) => `${STEP4}/mockups/${screen.id}-${viewport.width}x${viewport.height}.svg`),
    })),
    globalInvariants: registry.globalInvariants,
    verdict: 'PASS_ALL_TWELVE_SCREEN_SPECS_DRAFTED',
  };
  writeJson(`${STEP4}/screen-specs.json`, screenSpecs);

  const components = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-component-inventory-v1',
    components: [
      { id: 'app-header', purpose: 'screen identity and contextual status', minimumHeight: 56 },
      { id: 'compact-hud', purpose: 'floor, coin and ruby only', maximumCurrencyCount: 3 },
      { id: 'scene-stage', purpose: 'character, battle or system focal visual', monetizationAllowed: false },
      { id: 'state-card', purpose: 'outcome, forecast, diagnosis and comparison', pendingVariantRequired: true },
      { id: 'primary-action', purpose: 'one decisive contextual action', minimumHeight: 48 },
      { id: 'secondary-action', purpose: 'reversible or informational action', minimumHeight: 44 },
      { id: 'recovery-panel', purpose: 'critical pending/conflict/reconciliation state', auditIdSupport: true },
      { id: 'bottom-navigation', purpose: 'battle, tower, team, shop and more', itemCount: 5, minimumHeight: 68 },
      { id: 'progress-meter', purpose: 'HP, break, pity, mastery and evolution', colorOnly: false },
      { id: 'ledger-row', purpose: 'paid/free wallet provenance', sourceLabelRequired: true },
      { id: 'confirmation-sheet', purpose: 'loss/keep/gain and irreversible confirmation', timeoutInferenceForbidden: true },
    ],
    forbiddenPatterns: ['battle-screen permanent store CTA', 'unlabeled icon-only economic action', 'tap damage CTA', 'motion-only danger telegraph', 'client-time claim eligibility'],
    verdict: 'PASS_COMPONENT_INVENTORY_DRAFT',
  };
  writeJson(`${STEP4}/component-inventory.json`, components);

  const stateCoverage = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-state-coverage-v1',
    screenCount: 12,
    screens: screenSpecs.screens.map((screen) => ({
      id: screen.id,
      canonicalStateCount: screen.canonicalUiStates.length,
      mapping: screen.canonicalUiStates.map((state) => ({ state, visualPattern: classifyState(state) })),
      showcased: { normal: screen.canonicalUiStates[0], critical: screen.showcasedCriticalState, recoveryAction: screen.showcasedRecoveryAction },
    })),
    universalPatterns: {
      pending: 'lock repeat economic action, retain transaction context, show neutral progress and audit identifier',
      recovery: 'read authoritative history or entity version, never create a replacement operation',
      blocked: 'explain cause, preserved state and allowed next action without monetization pressure',
      resolved: 'show exact outcome before allowing navigation away',
    },
    verdict: 'PASS_CANONICAL_STATE_VISUAL_MAPPING_DRAFT',
  };
  writeJson(`${STEP4}/state-coverage.json`, stateCoverage);

  const renderRecords = [];
  for (const screen of registry.screens) {
    for (const viewport of VIEWPORTS) {
      const relativePath = `${STEP4}/mockups/${screen.id}-${viewport.width}x${viewport.height}.svg`;
      writeText(relativePath, renderScreen(screen, viewport));
      const buffer = readFileSync(abs(relativePath));
      renderRecords.push({
        screenId: screen.id,
        canonicalName: screen.name,
        viewport: `${viewport.width}x${viewport.height}`,
        path: relativePath,
        bytes: buffer.length,
        sha256: sha256Buffer(buffer),
        normalStateShown: true,
        criticalStateShown: SCREEN_META[screen.id].critical,
      });
    }
  }

  writeText(`${STEP4}/mockup-gallery.html`, galleryHtml(registry.screens));

  const renderManifest = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-render-manifest-v1',
    generatedAt: new Date().toISOString(),
    repository: REPOSITORY,
    branch: BRANCH,
    generator: `${STEP4}/tools/build-step4-draft.mjs`,
    screenCount: 12,
    viewportCount: 3,
    renderCount: renderRecords.length,
    renders: renderRecords,
    gallery: {
      path: `${STEP4}/mockup-gallery.html`,
      bytes: readFileSync(abs(`${STEP4}/mockup-gallery.html`)).length,
      sha256: sha256File(`${STEP4}/mockup-gallery.html`),
    },
    limitations: {
      physicalIPhoneVerified: false,
      runtimeInteractionVerified: false,
      productionChanged: false,
      finalArtAssets: false,
      browserScreenshotEvidence: false,
    },
    verdict: 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_GENERATED',
  };
  writeJson(`${STEP4}/render-manifest.json`, renderManifest);

  const decisionLog = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-design-decision-log-v1',
    decisions: [
      { id: 'D01', decision: 'Keep battle as the largest scene and remove permanent monetization from S02.', reason: 'Cat, combat and tower are the first product value.' },
      { id: 'D02', decision: 'Use five stable navigation destinations and route specialist screens contextually.', reason: 'Twelve equal tabs would exceed one-thumb comprehension and mobile width.' },
      { id: 'D03', decision: 'Show one critical recovery state on every mockup.', reason: 'Permanent economy cannot be evaluated from happy-path screens alone.' },
      { id: 'D04', decision: 'Separate base rarity, evolution and mastery visually.', reason: 'They are distinct product axes and must not imply duplicate-gated evolution.' },
      { id: 'D05', decision: 'Show paid/free ruby provenance on S11.', reason: 'Refund deficit and source conservation are server-authoritative trust requirements.' },
      { id: 'D06', decision: 'Use original vector cats and abstract tower scenery.', reason: 'Avoid tracing or redistributing reference artwork while keeping a reviewable visual language.' },
      { id: 'D07', decision: 'Treat 320x667 as a content-priority test, not a scaled-down 390px canvas.', reason: 'Critical outcome, amount and CTA must survive the smallest target.' },
    ],
    openUntilCriticReview: ['final illustration density', 'Japanese copy length under OS large text', 'battle animation timing', 'haptic mapping', 'physical-device safe-area proof'],
    verdict: 'PASS_STEP4_DRAFT_DECISIONS_RECORDED',
  };
  writeJson(`${STEP4}/design-decision-log.json`, decisionLog);

  const entryReadback = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-entry-readback-v1',
    recordedAt: new Date().toISOString(),
    repository: REPOSITORY,
    branch: BRANCH,
    observedHead: git('rev-parse', 'HEAD'),
    observedTree: git('rev-parse', 'HEAD^{tree}'),
    step3Entry: STEP3_ENTRY,
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE), status: acceptance.status ?? 'ACTIVE' },
    screenRegistry: { path: REGISTRY, blob: gitBlob(REGISTRY), screenCount: registry.screenCount },
    step3TerminalReadback: { path: STEP3_LIVE, blob: gitBlob(STEP3_LIVE), verdict: step3Live.verdict },
    generatedArtifacts: {
      renderManifest: `${STEP4}/render-manifest.json`,
      gallery: `${STEP4}/mockup-gallery.html`,
      screenSpecs: `${STEP4}/screen-specs.json`,
      designSystem: `${STEP4}/design-system.json`,
      referenceAudit: `${STEP4}/reference-audit.json`,
    },
    scope: {
      runtimeChanged: false,
      productAssetsChanged: false,
      backendChanged: false,
      paymentProviderChanged: false,
      adNetworkChanged: false,
      productionAliasChanged: false,
      physicalIPhoneVerified: false,
      otherBranchWritten: false,
      pullRequestOperationPerformed: false,
    },
    phase: 'STEP4_DRAFT_GENERATED_PENDING_CRITICS_AND_FINAL_JUDGE',
    verdict: 'PASS_STEP4_ENTRY_AND_DRAFT_GENERATION_READBACK',
  };
  writeJson(`${STEP4}/entry-readback.json`, entryReadback);

  console.log(JSON.stringify({
    verdict: 'PASS_STEP4_DRAFT_GENERATION',
    screenCount: registry.screenCount,
    viewportCount: VIEWPORTS.length,
    renderCount: renderRecords.length,
    gallery: renderManifest.gallery.path,
  }));
}

main();
