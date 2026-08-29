(() => {
  'use strict';

  const canvas = document.getElementById('runtime-battle-canvas');
  const wrap = document.getElementById('battle-wrap');
  if (!canvas || !wrap) return;

  const DATA = window.GAME_DATA;
  if (!DATA) return;

  const context = canvas.getContext('2d', { alpha: false });
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const images = new Map();
  const background = new Image();
  let backgroundReady = false;
  let dpr = 1;
  let cssWidth = 390;
  let cssHeight = 320;
  let frameHandle = 0;
  let lastFrame = 0;

  background.onload = () => { backgroundReady = true; };
  background.onerror = () => { backgroundReady = false; };
  background.src = 'step4/s02/assets/s02-forest-approved.webp';

  function loadImage(key, src) {
    const image = new Image();
    image.onload = () => images.set(key, image);
    image.onerror = () => images.set(key, null);
    image.src = src;
  }

  Object.entries(DATA.ASSETS.cats).forEach(([id, meta]) => loadImage(`cats.${id}`, meta.src));
  Object.entries(DATA.ASSETS.enemies).forEach(([id, meta]) => loadImage(`enemies.${id}`, meta.src));

  function resize() {
    const rect = wrap.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(rect.width));
    cssHeight = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
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

  function drawCover(image) {
    const scale = Math.max(cssWidth / image.width, cssHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (cssWidth - width) / 2, (cssHeight - height) / 2, width, height);
  }

  function drawBackground() {
    context.fillStyle = '#69865a';
    context.fillRect(0, 0, cssWidth, cssHeight);
    if (backgroundReady) drawCover(background);

    const glow = context.createLinearGradient(0, 0, 0, cssHeight);
    glow.addColorStop(0, 'rgba(255,245,190,.10)');
    glow.addColorStop(.62, 'rgba(70,45,24,.04)');
    glow.addColorStop(1, 'rgba(32,15,9,.34)');
    context.fillStyle = glow;
    context.fillRect(0, 0, cssWidth, cssHeight);

    const groundY = cssHeight * .81;
    const ground = context.createLinearGradient(0, groundY, 0, cssHeight);
    ground.addColorStop(0, 'rgba(117,91,51,.30)');
    ground.addColorStop(1, 'rgba(55,31,18,.52)');
    context.fillStyle = ground;
    context.fillRect(0, groundY, cssWidth, cssHeight - groundY);
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

  function drawShadow(x, y, radius) {
    context.save();
    context.fillStyle = 'rgba(38,20,11,.34)';
    context.beginPath();
    context.ellipse(x, y + 2, radius, radius * .28, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawSprite(group, id, x, y, targetHeight, options = {}) {
    const meta = DATA.ASSETS[group]?.[id];
    const image = images.get(`${group}.${id}`);
    if (!meta) return;

    context.save();
    context.translate(x, y);
    if (options.flip) context.scale(-1, 1);
    if (options.faint) context.rotate(-Math.PI * .38);
    if (!reducedMotion?.matches && options.bob) {
      context.translate(0, -Math.abs(Math.sin(options.phase || 0)) * 2.2);
    }

    if (image) {
      const metrics = spriteMetrics(image, meta, targetHeight);
      context.shadowColor = 'rgba(28,12,6,.55)';
      context.shadowBlur = 4;
      context.drawImage(image, metrics.dx, metrics.dy, metrics.width, metrics.height);
    } else {
      context.fillStyle = meta.fallback?.tint || '#d9b36d';
      context.beginPath();
      context.ellipse(0, -targetHeight * .46, targetHeight * .35, targetHeight * .45, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawHpBar(x, y, width, ratio, color) {
    const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    context.fillStyle = 'rgba(27,10,6,.88)';
    context.fillRect(x - width / 2 - 1, y - 1, width + 2, 7);
    context.fillStyle = '#f6e7c7';
    context.fillRect(x - width / 2, y, width, 5);
    context.fillStyle = color;
    context.fillRect(x - width / 2 + 1, y + 1, Math.max(0, (width - 2) * safeRatio), 3);
  }

  function drawActualUnits(time) {
    const game = window.__game;
    if (!game) return;

    const worldWidth = DATA.BALANCE.world.width || 390;
    const scaleX = cssWidth / worldWidth;
    const groundY = cssHeight * .82;
    const cats = Array.isArray(game.fieldCats) ? game.fieldCats : [];
    const enemies = Array.isArray(game.enemies) ? game.enemies : [];

    const visibleCats = cats.slice(0, 4);
    visibleCats.forEach((cat, index) => {
      const job = DATA.JOBS[cat.jobId];
      if (!job) return;
      const x = cssWidth - (Number(cat.x) || 0) * scaleX;
      const lane = index % 2;
      const row = index < 2 ? 0 : 1;
      const y = groundY - row * 62 + lane * 5;
      drawShadow(x, y, 15);
      drawSprite('cats', job.sprite, x, y, 58, {
        flip: true,
        faint: cat.state === 'faint',
        bob: cat.state === 'walk',
        phase: time * 7 + (cat.uid || index)
      });
      drawHpBar(x, y - 61, 50, cat.state === 'faint' ? .18 : 1, '#4fbd58');
    });

    if (cats.length > visibleCats.length) {
      context.save();
      context.fillStyle = 'rgba(42,18,10,.86)';
      context.strokeStyle = '#e4ac4b';
      context.lineWidth = 1;
      context.fillRect(8, groundY - 144, 55, 22);
      context.strokeRect(8.5, groundY - 143.5, 54, 21);
      context.fillStyle = '#ffe39a';
      context.font = '12px DotGothic16, sans-serif';
      context.textAlign = 'center';
      context.fillText(`増援 +${cats.length - visibleCats.length}`, 35, groundY - 129);
      context.restore();
    }

    enemies.slice(0, 3).forEach((enemy, index) => {
      const x = cssWidth - (Number(enemy.x) || 0) * scaleX;
      const row = index === 0 ? 0 : 1;
      const y = groundY - row * 62 + (index === 2 ? 9 : 0);
      const height = enemy.boss ? 118 : 58;
      drawShadow(x, y, enemy.boss ? 32 : 17);
      drawSprite('enemies', enemy.sprite, x, y, height, {
        flip: true,
        bob: true,
        phase: time * 4 + (enemy.uid || index)
      });
      drawHpBar(x, y - height * .78, enemy.boss ? 82 : 46, enemy.maxHp ? enemy.hp / enemy.maxHp : 1, '#d94c42');
    });
  }

  function draw(time) {
    resize();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    drawBackground();
    drawActualUnits(time / 1000);

    const game = window.__game;
    canvas.dataset.gameFloor = game ? String(game.floor) : '';
    canvas.dataset.actualCatCount = game && Array.isArray(game.fieldCats) ? String(game.fieldCats.length) : '0';
    canvas.dataset.actualEnemyCount = game && Array.isArray(game.enemies) ? String(game.enemies.length) : '0';
    canvas.dataset.rendererReady = 'true';

    lastFrame = time;
    frameHandle = window.requestAnimationFrame(draw);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(wrap);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    window.cancelAnimationFrame(frameHandle);
  });

  resize();
  frameHandle = window.requestAnimationFrame(draw);
  window.__s02BattleRenderer = Object.freeze({
    ready: true,
    source: 'window.__game',
    background: 'step4/s02/assets/s02-forest-approved.webp',
    legacyCanvasVisible: false,
    productionChanged: false
  });
})();
