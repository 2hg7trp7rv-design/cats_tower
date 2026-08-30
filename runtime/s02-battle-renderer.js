(() => {
  'use strict';

  const canvas = document.getElementById('runtime-battle-canvas');
  const wrap = document.getElementById('battle-wrap');
  const DATA = window.GAME_DATA;
  if (!canvas || !wrap || !DATA) return;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const images = new Map();
  const background = new Image();
  const effects = [];
  const lightMotes = Array.from({ length: 15 }, (_, index) => ({
    x: (index * 47) % 389,
    y: 34 + ((index * 71) % 220),
    phase: index * 0.73,
    radius: 0.7 + (index % 3) * 0.55
  }));

  let backgroundReady = false;
  let dpr = 1;
  let cssWidth = 390;
  let cssHeight = 350;
  let frameHandle = 0;
  let previousTime = performance.now();
  let hitSerial = 0;

  background.onload = () => { backgroundReady = true; };
  background.onerror = () => { backgroundReady = false; };
  background.src = 'step4/s02/assets/s02-forest-approved.webp';

  function loadImage(key, src) {
    const image = new Image();
    image.onload = () => images.set(key, image);
    image.onerror = () => images.set(key, null);
    image.src = src;
  }

  Object.entries(DATA.ASSETS?.cats || {}).forEach(([id, meta]) => loadImage(`cats.${id}`, meta.src));
  Object.entries(DATA.ASSETS?.enemies || {}).forEach(([id, meta]) => loadImage(`enemies.${id}`, meta.src));

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function safeNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function format(value) {
    return typeof DATA.fmt === 'function' ? DATA.fmt(safeNumber(value)) : String(Math.floor(safeNumber(value)));
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(rect.width));
    cssHeight = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2.25, window.devicePixelRatio || 1);
    const nextWidth = Math.round(cssWidth * dpr);
    const nextHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;
  }

  function roundedPath(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawCover(image) {
    const scale = Math.max(cssWidth / image.width, cssHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (cssWidth - width) / 2, (cssHeight - height) / 2, width, height);
  }

  function drawBackground(time) {
    context.fillStyle = '#3f5845';
    context.fillRect(0, 0, cssWidth, cssHeight);
    if (backgroundReady) drawCover(background);

    const canopy = context.createLinearGradient(0, 0, 0, cssHeight * 0.56);
    canopy.addColorStop(0, 'rgba(8,18,18,.70)');
    canopy.addColorStop(.42, 'rgba(25,46,39,.30)');
    canopy.addColorStop(1, 'rgba(67,73,42,.04)');
    context.fillStyle = canopy;
    context.fillRect(0, 0, cssWidth, cssHeight * .62);

    const centralLight = context.createRadialGradient(
      cssWidth * .49, cssHeight * .35, 5,
      cssWidth * .49, cssHeight * .35, cssWidth * .52
    );
    centralLight.addColorStop(0, 'rgba(255,227,129,.22)');
    centralLight.addColorStop(.42, 'rgba(218,197,112,.08)');
    centralLight.addColorStop(1, 'rgba(19,15,12,0)');
    context.fillStyle = centralLight;
    context.fillRect(0, 0, cssWidth, cssHeight);

    const horizon = cssHeight * .68;
    const ground = context.createLinearGradient(0, horizon, 0, cssHeight);
    ground.addColorStop(0, 'rgba(97,78,44,.14)');
    ground.addColorStop(.22, 'rgba(69,48,28,.42)');
    ground.addColorStop(1, 'rgba(22,12,10,.86)');
    context.fillStyle = ground;
    context.fillRect(0, horizon, cssWidth, cssHeight - horizon);

    context.save();
    context.globalAlpha = .18;
    context.fillStyle = '#e7c86d';
    context.beginPath();
    context.moveTo(cssWidth * .36, horizon);
    context.lineTo(cssWidth * .62, horizon);
    context.lineTo(cssWidth * .78, cssHeight);
    context.lineTo(cssWidth * .18, cssHeight);
    context.closePath();
    context.fill();
    context.restore();

    context.save();
    context.strokeStyle = 'rgba(222,176,81,.24)';
    context.lineWidth = 1;
    for (let i = 0; i < 5; i += 1) {
      const y = horizon + 13 + i * 19;
      context.beginPath();
      context.moveTo(cssWidth * (.31 - i * .025), y);
      context.lineTo(cssWidth * (.68 + i * .025), y);
      context.stroke();
    }
    context.restore();

    context.save();
    context.globalCompositeOperation = 'screen';
    for (const mote of lightMotes) {
      const drift = reducedMotion?.matches ? 0 : Math.sin(time * .65 + mote.phase) * 5;
      const alpha = .12 + (Math.sin(time * 1.2 + mote.phase) + 1) * .045;
      context.fillStyle = `rgba(255,228,137,${alpha.toFixed(3)})`;
      context.beginPath();
      context.arc((mote.x / 390) * cssWidth + drift, (mote.y / 350) * cssHeight, mote.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.fillStyle = 'rgba(23,10,9,.55)';
    context.fillRect(0, 0, 6, cssHeight);
    context.fillRect(cssWidth - 6, 0, 6, cssHeight);
    context.restore();
  }

  function spriteMetrics(image, meta, targetHeight) {
    const bounds = meta.visibleBounds || [0, 0, 1, 1];
    const visibleHeight = Math.max(.05, bounds[3]);
    const imageHeight = targetHeight / visibleHeight;
    const imageWidth = imageHeight * (image.width / image.height);
    return {
      width: imageWidth,
      height: imageHeight,
      dx: -imageWidth * meta.footAnchor[0],
      dy: -imageHeight * meta.footAnchor[1]
    };
  }

  function drawShadow(x, y, radius, alpha = .38) {
    context.save();
    context.fillStyle = `rgba(20,10,8,${alpha})`;
    context.filter = 'blur(1px)';
    context.beginPath();
    context.ellipse(x, y + 3, radius, radius * .28, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawSprite(group, id, x, y, targetHeight, options = {}) {
    const meta = DATA.ASSETS?.[group]?.[id];
    const image = images.get(`${group}.${id}`);
    if (!meta) return;

    context.save();
    context.translate(x, y);
    if (options.flip) context.scale(-1, 1);
    if (options.faint) context.rotate(-Math.PI * .36);
    if (!reducedMotion?.matches && options.bob) {
      context.translate(0, -Math.abs(Math.sin(options.phase || 0)) * 2.4);
    }
    if (options.hitFlash) {
      context.shadowColor = '#fff5bf';
      context.shadowBlur = 15;
    } else {
      context.shadowColor = 'rgba(18,7,6,.68)';
      context.shadowBlur = 5;
    }

    if (image) {
      const metrics = spriteMetrics(image, meta, targetHeight);
      context.drawImage(image, metrics.dx, metrics.dy, metrics.width, metrics.height);
    } else {
      context.fillStyle = meta.fallback?.tint || '#d9b36d';
      context.beginPath();
      context.ellipse(0, -targetHeight * .46, targetHeight * .35, targetHeight * .45, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawHpBar(x, y, width, ratio, color, label = '') {
    const safeRatio = clamp(ratio);
    context.save();
    roundedPath(x - width / 2 - 2, y - 2, width + 4, label ? 15 : 10, 3);
    context.fillStyle = 'rgba(28,10,9,.88)';
    context.fill();
    context.strokeStyle = 'rgba(255,220,126,.72)';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#e7d6a9';
    context.fillRect(x - width / 2, y, width, 6);
    context.fillStyle = color;
    context.fillRect(x - width / 2 + 1, y + 1, Math.max(0, (width - 2) * safeRatio), 4);
    if (label) {
      context.fillStyle = '#fff1c8';
      context.font = '8px DotGothic16, sans-serif';
      context.textAlign = 'center';
      context.fillText(label, x, y + 13);
    }
    context.restore();
  }

  function drawRoleBadge(x, y, text, color) {
    context.save();
    context.fillStyle = 'rgba(29,12,9,.88)';
    context.strokeStyle = color;
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(x, y, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#fff0c6';
    context.font = '8px DotGothic16, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, x, y + .5);
    context.restore();
  }

  function roleMeta(jobId) {
    switch (jobId) {
      case 'warrior': return { mark: '剣', color: '#f0b74b' };
      case 'mage': return { mark: '術', color: '#b86bea' };
      case 'archer': return { mark: '弓', color: '#74d36a' };
      case 'guardian': return { mark: '盾', color: '#72baf2' };
      case 'ninja': return { mark: '忍', color: '#ee6d78' };
      default: return { mark: '猫', color: '#d7b06e' };
    }
  }

  function catScreenPosition(cat, index, enemy) {
    const lanes = [
      { x: .69, y: .69 },
      { x: .78, y: .55 },
      { x: .81, y: .72 },
      { x: .70, y: .47 }
    ];
    const lane = lanes[index % lanes.length];
    const targetWorld = enemy ? Math.max(70, safeNumber(enemy.x, 258) - 30) : 228;
    const progress = clamp((safeNumber(cat.x, 30) - 30) / Math.max(1, targetWorld - 30));
    return {
      x: cssWidth * (lane.x - progress * .18),
      y: cssHeight * lane.y,
      progress
    };
  }

  function enemyScreenPosition(enemy, index) {
    if (enemy.boss) return { x: cssWidth * .31, y: cssHeight * .68 };
    const lanes = [
      { x: .29, y: .67 },
      { x: .38, y: .55 },
      { x: .22, y: .49 }
    ];
    return {
      x: cssWidth * lanes[index % lanes.length].x,
      y: cssHeight * lanes[index % lanes.length].y
    };
  }

  function drawFormationMarkers(actualCount) {
    const lanes = [
      { x: .69, y: .69 },
      { x: .78, y: .55 },
      { x: .81, y: .72 },
      { x: .70, y: .47 }
    ];
    context.save();
    for (let index = actualCount; index < 4; index += 1) {
      const lane = lanes[index];
      const x = cssWidth * lane.x;
      const y = cssHeight * lane.y;
      context.setLineDash([3, 3]);
      context.strokeStyle = 'rgba(255,219,122,.28)';
      context.lineWidth = 1.2;
      context.beginPath();
      context.ellipse(x, y, 19, 7, 0, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = 'rgba(39,18,12,.52)';
      context.beginPath();
      context.arc(x, y - 22, 12, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(255,219,122,.34)';
      context.stroke();
      context.fillStyle = 'rgba(255,237,190,.55)';
      context.font = '9px DotGothic16, sans-serif';
      context.textAlign = 'center';
      context.fillText(`${index + 1}枠`, x, y - 19);
    }
    context.restore();
  }

  function drawAttackFx(cat, catPos, enemyPos, time, game) {
    if (cat.state !== 'fight' || !enemyPos) return;
    const interval = Math.max(.05, safeNumber(game.catInterval?.(cat.jobId), 1));
    const phase = clamp(safeNumber(cat.atkT) / interval);
    if (phase < .62) return;
    const strength = clamp((phase - .62) / .38);
    const role = roleMeta(cat.jobId);

    context.save();
    context.globalAlpha = .25 + strength * .65;
    context.strokeStyle = role.color;
    context.fillStyle = role.color;
    context.lineWidth = 2 + strength * 2;
    context.shadowColor = role.color;
    context.shadowBlur = 8;

    if (cat.jobId === 'mage') {
      const px = catPos.x + (enemyPos.x - catPos.x) * strength;
      const py = catPos.y - 46 + (enemyPos.y - 48 - (catPos.y - 46)) * strength;
      context.beginPath();
      context.arc(px, py, 5 + strength * 3, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(catPos.x - 3, catPos.y - 44);
      context.lineTo(px, py);
      context.stroke();
    } else if (cat.jobId === 'archer') {
      const px = catPos.x + (enemyPos.x - catPos.x) * strength;
      const py = catPos.y - 38 + (enemyPos.y - 48 - (catPos.y - 38)) * strength;
      context.beginPath();
      context.moveTo(catPos.x - 7, catPos.y - 38);
      context.lineTo(px, py);
      context.stroke();
      context.beginPath();
      context.moveTo(px, py);
      context.lineTo(px + 7, py - 4);
      context.lineTo(px + 5, py + 5);
      context.closePath();
      context.fill();
    } else if (cat.jobId === 'guardian') {
      context.beginPath();
      context.arc(enemyPos.x, enemyPos.y - 14, 12 + strength * 20, 0, Math.PI * 2);
      context.stroke();
    } else {
      const centerX = enemyPos.x + 8;
      const centerY = enemyPos.y - 30;
      context.beginPath();
      context.arc(centerX, centerY, 18 + strength * 11, Math.PI * .72, Math.PI * 1.48);
      context.stroke();
      context.beginPath();
      context.arc(centerX - 4, centerY + 3, 13 + strength * 8, Math.PI * .73, Math.PI * 1.43);
      context.stroke();
    }
    context.restore();
  }

  function drawBossTelegraph(enemy, position, time) {
    if (!enemy?.boss) return;
    const interval = safeNumber(DATA.BALANCE?.bossAttackInterval, 3);
    const remaining = Math.max(0, safeNumber(enemy.atkT, interval));
    const ratio = clamp(1 - remaining / interval);
    context.save();
    context.globalAlpha = .24 + ratio * .42;
    context.strokeStyle = ratio > .72 ? '#ff6b57' : '#f5bd52';
    context.lineWidth = 2;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.ellipse(position.x, position.y + 2, 58 + ratio * 12, 17 + ratio * 4, 0, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = 'rgba(39,12,12,.78)';
    roundedPath(position.x - 47, position.y - 126, 94, 18, 4);
    context.fill();
    context.strokeStyle = '#efb95a';
    context.stroke();
    context.fillStyle = '#ffe6a4';
    context.font = '9px DotGothic16, sans-serif';
    context.textAlign = 'center';
    context.fillText(`反撃まで ${remaining.toFixed(1)}秒`, position.x, position.y - 114);
    context.restore();
  }

  function drawActualUnits(time) {
    const game = window.__game;
    if (!game) return { cats: [], enemies: [], enemyPositions: [] };

    const cats = Array.isArray(game.fieldCats) ? game.fieldCats.slice(0, 4) : [];
    const enemies = Array.isArray(game.enemies) ? game.enemies.slice(0, 3) : [];
    const primaryEnemy = typeof game.nearestEnemy === 'function' ? game.nearestEnemy() : enemies[0];
    const enemyPositions = enemies.map(enemyScreenPosition);

    drawFormationMarkers(cats.length);

    enemies.forEach((enemy, index) => {
      const position = enemyPositions[index];
      const height = enemy.boss ? Math.min(178, cssHeight * .50) : Math.min(78, cssHeight * .22);
      const hitFlash = effects.some((effect) => effect.kind === 'hit' && effect.age < .11);
      drawShadow(position.x, position.y, enemy.boss ? 45 : 20, enemy.boss ? .52 : .40);
      if (enemy.boss) {
        const aura = context.createRadialGradient(position.x, position.y - height * .46, 4, position.x, position.y - height * .46, height * .67);
        aura.addColorStop(0, 'rgba(185,78,220,.32)');
        aura.addColorStop(.55, 'rgba(105,42,140,.13)');
        aura.addColorStop(1, 'rgba(68,25,90,0)');
        context.fillStyle = aura;
        context.fillRect(position.x - height, position.y - height * 1.25, height * 2, height * 1.6);
      }
      drawSprite('enemies', enemy.sprite, position.x, position.y, height, {
        flip: true,
        bob: true,
        hitFlash,
        phase: time * (enemy.boss ? 2.2 : 3.4) + safeNumber(enemy.uid, index)
      });
      const ratio = enemy.maxHp ? enemy.hp / enemy.maxHp : 1;
      drawHpBar(position.x, position.y - height * .80, enemy.boss ? Math.min(122, cssWidth * .38) : 55, ratio, '#db5146', enemy.boss ? '階層主' : '敵');
      drawBossTelegraph(enemy, position, time);
    });

    const primaryIndex = Math.max(0, enemies.indexOf(primaryEnemy));
    const primaryPos = enemyPositions[primaryIndex] || { x: cssWidth * .30, y: cssHeight * .64 };
    cats.forEach((cat, index) => {
      const job = DATA.JOBS?.[cat.jobId];
      if (!job) return;
      const position = catScreenPosition(cat, index, primaryEnemy);
      const targetHeight = Math.min(index === 0 ? 86 : 76, cssHeight * .25);
      const role = roleMeta(cat.jobId);
      drawShadow(position.x, position.y, 20);
      drawAttackFx(cat, position, primaryPos, time, game);
      drawSprite('cats', job.sprite, position.x, position.y, targetHeight, {
        flip: true,
        faint: cat.state === 'faint',
        bob: cat.state === 'walk',
        phase: time * 6 + safeNumber(cat.uid, index)
      });
      drawHpBar(position.x, position.y - targetHeight * .79, 56, cat.state === 'faint' ? .18 : 1, '#56c961');
      drawRoleBadge(position.x + 21, position.y - 22, role.mark, role.color);
      context.save();
      context.fillStyle = 'rgba(30,12,9,.74)';
      roundedPath(position.x - 32, position.y + 7, 64, 14, 4);
      context.fill();
      context.fillStyle = '#fff0c8';
      context.font = '8px DotGothic16, sans-serif';
      context.textAlign = 'center';
      context.fillText(job.name.replace('ねこ', ''), position.x, position.y + 17);
      context.restore();
    });

    if (Array.isArray(game.fieldCats) && game.fieldCats.length > cats.length) {
      context.save();
      context.fillStyle = 'rgba(41,17,11,.88)';
      context.strokeStyle = '#e2a846';
      roundedPath(cssWidth - 112, cssHeight * .26, 54, 23, 5);
      context.fill();
      context.stroke();
      context.fillStyle = '#ffe39a';
      context.font = '10px DotGothic16, sans-serif';
      context.textAlign = 'center';
      context.fillText(`増援 +${game.fieldCats.length - cats.length}`, cssWidth - 85, cssHeight * .26 + 15);
      context.restore();
    }

    return { cats, enemies, enemyPositions };
  }

  function addEffect(detail) {
    const kind = detail.type === 'hit' ? 'hit'
      : detail.type === 'add-down' || detail.type === 'floor-clear' ? 'reward'
        : detail.type === 'summon' || detail.type === 'auto-spawn' ? 'summon'
          : detail.type === 'cat-faint' ? 'warning' : 'pulse';
    effects.push({
      kind,
      age: 0,
      life: kind === 'reward' ? 1.1 : kind === 'hit' ? .72 : .8,
      damage: safeNumber(detail.dmg),
      coin: safeNumber(detail.coin),
      serial: ++hitSerial
    });
    if (effects.length > 18) effects.splice(0, effects.length - 18);
  }

  function updateAndDrawEffects(dt, enemyPositions) {
    const enemyPos = enemyPositions[0] || { x: cssWidth * .31, y: cssHeight * .64 };
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const effect = effects[index];
      effect.age += dt;
      if (effect.age >= effect.life) {
        effects.splice(index, 1);
        continue;
      }
      const p = clamp(effect.age / effect.life);
      const alpha = 1 - p;
      context.save();
      if (effect.kind === 'hit') {
        const spread = ((effect.serial % 3) - 1) * 17;
        const x = enemyPos.x + spread;
        const y = enemyPos.y - 62 - p * 28;
        context.globalAlpha = alpha;
        context.fillStyle = effect.damage > 20 ? '#ffe378' : '#ffffff';
        context.strokeStyle = '#4a160f';
        context.lineWidth = 4;
        context.font = `${effect.damage > 20 ? 18 : 15}px DotGothic16, sans-serif`;
        context.textAlign = 'center';
        const text = format(effect.damage);
        context.strokeText(text, x, y);
        context.fillText(text, x, y);
        context.globalAlpha = alpha * .85;
        context.strokeStyle = '#fff4b3';
        context.lineWidth = 2;
        context.beginPath();
        for (let ray = 0; ray < 8; ray += 1) {
          const angle = ray * Math.PI / 4;
          const inner = 8 + p * 7;
          const outer = 23 + p * 16;
          context.moveTo(enemyPos.x + Math.cos(angle) * inner, enemyPos.y - 40 + Math.sin(angle) * inner);
          context.lineTo(enemyPos.x + Math.cos(angle) * outer, enemyPos.y - 40 + Math.sin(angle) * outer);
        }
        context.stroke();
      } else if (effect.kind === 'reward') {
        const x = enemyPos.x;
        const y = enemyPos.y - 62 - p * 35;
        context.globalAlpha = alpha;
        context.fillStyle = '#ffd85d';
        context.strokeStyle = '#4c210d';
        context.lineWidth = 3;
        context.font = '15px DotGothic16, sans-serif';
        context.textAlign = 'center';
        const text = effect.coin > 0 ? `+${format(effect.coin)}G` : '制圧!';
        context.strokeText(text, x, y);
        context.fillText(text, x, y);
        for (let coin = 0; coin < 6; coin += 1) {
          const angle = coin * Math.PI / 3 + p;
          context.beginPath();
          context.arc(x + Math.cos(angle) * (12 + p * 26), y + Math.sin(angle) * (8 + p * 18), 3, 0, Math.PI * 2);
          context.fill();
        }
      } else if (effect.kind === 'summon') {
        const x = cssWidth * .79;
        const y = cssHeight * .68;
        context.globalAlpha = alpha * .75;
        context.strokeStyle = '#f6d477';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, y, 14 + p * 32, 0, Math.PI * 2);
        context.stroke();
      } else if (effect.kind === 'warning') {
        context.globalAlpha = alpha * .28;
        context.fillStyle = '#ed5547';
        context.fillRect(0, 0, cssWidth, cssHeight);
      }
      context.restore();
    }
  }

  function drawCombatLane(unitState) {
    if (!unitState.enemies.length) return;
    const cat = unitState.cats.find((item) => item.state !== 'faint');
    const enemy = unitState.enemies[0];
    if (!cat || !enemy) return;
    const catPos = catScreenPosition(cat, 0, enemy);
    const enemyPos = unitState.enemyPositions[0];
    context.save();
    context.setLineDash([4, 6]);
    context.strokeStyle = cat.state === 'fight' ? 'rgba(255,221,117,.34)' : 'rgba(223,238,204,.22)';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(catPos.x - 10, catPos.y - 22);
    context.quadraticCurveTo(cssWidth * .49, cssHeight * .47, enemyPos.x + 14, enemyPos.y - 26);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = 'rgba(32,14,10,.76)';
    roundedPath(cssWidth * .43, cssHeight * .43, cssWidth * .18, 20, 5);
    context.fill();
    context.strokeStyle = 'rgba(237,187,82,.58)';
    context.stroke();
    context.fillStyle = '#ffe5a4';
    context.font = '9px DotGothic16, sans-serif';
    context.textAlign = 'center';
    context.fillText(cat.state === 'fight' ? '接敵・攻撃中' : '前線へ接近', cssWidth * .52, cssHeight * .43 + 13);
    context.restore();
  }

  function drawVignette() {
    const vignette = context.createRadialGradient(cssWidth * .5, cssHeight * .48, cssWidth * .18, cssWidth * .5, cssHeight * .48, cssWidth * .72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(.72, 'rgba(24,9,8,.08)');
    vignette.addColorStop(1, 'rgba(16,6,6,.58)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, cssWidth, cssHeight);

    context.save();
    context.strokeStyle = 'rgba(255,215,113,.24)';
    context.lineWidth = 1;
    context.strokeRect(5.5, 5.5, cssWidth - 11, cssHeight - 11);
    context.restore();
  }

  function draw(time) {
    resize();
    const now = performance.now();
    const dt = Math.min(.05, Math.max(0, (now - previousTime) / 1000));
    previousTime = now;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    drawBackground(time / 1000);
    const unitState = drawActualUnits(time / 1000);
    drawCombatLane(unitState);
    updateAndDrawEffects(dt, unitState.enemyPositions);
    drawVignette();

    const game = window.__game;
    canvas.dataset.gameFloor = game ? String(game.floor) : '';
    canvas.dataset.actualCatCount = game && Array.isArray(game.fieldCats) ? String(game.fieldCats.length) : '0';
    canvas.dataset.actualEnemyCount = game && Array.isArray(game.enemies) ? String(game.enemies.length) : '0';
    canvas.dataset.partySlotCount = '4';
    canvas.dataset.visualCausalityReady = 'true';
    canvas.dataset.visualRepairVersion = 's02-visual-repair-round-001';
    canvas.dataset.rendererReady = 'true';

    frameHandle = window.requestAnimationFrame(draw);
  }

  function onActualGameEvent(event) {
    if (event?.detail?.type) addEffect(event.detail);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(wrap);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('cats-tower:s02-event', onActualGameEvent);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    window.removeEventListener('cats-tower:s02-event', onActualGameEvent);
    window.cancelAnimationFrame(frameHandle);
  });

  resize();
  frameHandle = window.requestAnimationFrame(draw);
  window.__s02BattleRenderer = Object.freeze({
    ready: true,
    version: 's02-visual-repair-round-001',
    source: 'window.__game',
    eventSource: 'cats-tower:s02-event',
    background: 'step4/s02/assets/s02-forest-approved.webp',
    partySlots: 4,
    visualCausality: true,
    legacyCanvasVisible: false,
    gameplayCoreChanged: false,
    productionChanged: false
  });
})();
