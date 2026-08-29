(() => {
  'use strict';

  const shell = document.querySelector('[data-testid="s02-runtime-shell"]');
  if (!shell) return;

  const byId = (id) => document.getElementById(id);
  const toast = byId('runtime-toast');
  const runtimeScroll = byId('runtime-scroll');
  const supportAnchor = byId('runtime-support-anchor');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let toastTimer = 0;
  let mirrorTimer = 0;

  function mountActualStateRenderer() {
    const legacyCanvas = byId('battle');
    if (!legacyCanvas) return;
    let runtimeCanvas = byId('runtime-battle-canvas');
    if (!runtimeCanvas) {
      runtimeCanvas = document.createElement('canvas');
      runtimeCanvas.id = 'runtime-battle-canvas';
      runtimeCanvas.className = 'runtime-battle-canvas';
      runtimeCanvas.setAttribute('aria-hidden', 'true');
      legacyCanvas.insertAdjacentElement('afterend', runtimeCanvas);
    }
    if (!document.querySelector('script[data-s02-battle-renderer]')) {
      const script = document.createElement('script');
      script.src = 'runtime/s02-battle-renderer.js';
      script.async = true;
      script.dataset.s02BattleRenderer = 'true';
      script.addEventListener('error', () => {
        shell.dataset.rendererReady = 'error';
      });
      document.head.appendChild(script);
    }
  }

  const query = new URLSearchParams(window.location.search);
  if (query.get('largeText') === '1') document.body.classList.add('runtime-large-text');

  function showToast(message, duration = 1700) {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), duration);
  }

  function getGame() {
    return window.__game || null;
  }

  function safeNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function clickExisting(selector, unavailableMessage) {
    const target = document.querySelector(selector);
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') {
      showToast(unavailableMessage);
      return false;
    }
    target.click();
    return true;
  }

  function scrollToElement(element) {
    if (!runtimeScroll || !element) return;
    const top = Math.max(0, element.offsetTop - 8);
    runtimeScroll.scrollTo({
      top,
      behavior: reducedMotion?.matches ? 'auto' : 'smooth'
    });
  }

  function performRuntimeAction(action) {
    const game = getGame();
    switch (action) {
      case 'battle':
      case 'tower':
        runtimeScroll?.scrollTo({ top: 0, behavior: reducedMotion?.matches ? 'auto' : 'smooth' });
        showToast('現在の戦闘へ戻りました');
        return;
      case 'commerce':
        scrollToElement(supportAnchor || byId('tower-list'));
        showToast('商会・店舗状況へ移動しました');
        return;
      case 'agency':
      case 'party':
        clickExisting('#tab-agency', '仲間情報は準備中です。戦闘を進めると派遣屋が更新されます');
        return;
      case 'forge':
        clickExisting('#tab-forge', '武器屋を建てると鍛冶・装備を利用できます');
        return;
      case 'item':
        clickExisting('#tab-item', '道具屋を建てると支援アイテムを利用できます');
        return;
      case 'shops': {
        const pending = byId('btn-shop-pending');
        if (pending && getComputedStyle(pending).display !== 'none' && !pending.disabled) {
          pending.click();
        } else {
          scrollToElement(byId('tower-list'));
          showToast('制圧した空き階から店舗を建てられます');
        }
        return;
      }
      case 'return': {
        const button = byId('btn-dawn');
        if (!button || button.disabled) {
          const floor = game ? safeNumber(game.maxFloor, 1) : 1;
          showToast(`塔還りは条件未達です（最高 ${floor}F）`);
          return;
        }
        button.click();
        return;
      }
      case 'next':
        runtimeScroll?.scrollTo({ top: 0, behavior: reducedMotion?.matches ? 'auto' : 'smooth' });
        showToast('次の階層へ自動進軍中です');
        return;
      case 'events':
        showToast('催事画面はStep 4の別画面として制作中です');
        return;
      default:
        showToast('この機能は現在の実装範囲外です');
    }
  }

  function setActiveNav(button) {
    document.querySelectorAll('.runtime-nav-button').forEach((item) => {
      item.classList.remove('is-active');
      item.removeAttribute('aria-current');
    });
    button.classList.add('is-active');
    button.setAttribute('aria-current', 'page');
  }

  document.querySelectorAll('[data-runtime-action]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') {
        performRuntimeAction(button.dataset.runtimeAction);
        return;
      }
      if (button.classList.contains('runtime-nav-button')) setActiveNav(button);
      performRuntimeAction(button.dataset.runtimeAction);
    });
  });

  byId('runtime-event-banner')?.addEventListener('click', () => performRuntimeAction('battle'));
  byId('runtime-next-target')?.addEventListener('click', () => performRuntimeAction('next'));

  function updateActionAvailability(game) {
    const forge = document.querySelector('[data-runtime-action="forge"]');
    const item = document.querySelector('[data-runtime-action="item"]');
    const returnButton = byId('btn-dawn');
    const returnState = byId('runtime-return-state');

    const forgeReady = typeof game.weaponRank === 'function' && game.weaponRank() > 0;
    const itemReady = typeof game.itemRank === 'function' && game.itemRank() > 0;
    if (forge) forge.setAttribute('aria-disabled', String(!forgeReady));
    if (item) item.setAttribute('aria-disabled', String(!itemReady));

    if (returnState) returnState.textContent = returnButton && !returnButton.disabled ? '可能' : '条件未達';
  }

  function mirrorGameState() {
    const game = getGame();
    if (!game) return false;

    const floor = Math.max(1, Math.floor(safeNumber(game.floor, 1)));
    const maxFloor = Math.max(floor, Math.floor(safeNumber(game.maxFloor, floor)));
    const teamLevel = typeof game.totalJobLv === 'function'
      ? Math.max(1, Math.floor(safeNumber(game.totalJobLv(), 1)))
      : 1;
    const progress = Math.max(8, Math.min(100, teamLevel % 100 || 100));
    const cats = Array.isArray(game.fieldCats) ? game.fieldCats.length : 0;
    const enemies = Array.isArray(game.enemies) ? game.enemies.length : 0;

    const maxFloorEl = byId('runtime-max-floor');
    const nextFloorEl = byId('runtime-next-floor');
    const teamLevelEl = byId('runtime-team-level');
    const profileProgress = byId('runtime-profile-progress');
    const partyCount = byId('runtime-party-count');
    const enemyCount = byId('runtime-enemy-count');
    const expeditionStatus = byId('runtime-expedition-status');
    const eventState = byId('runtime-event-state');

    if (maxFloorEl) maxFloorEl.textContent = `${maxFloor}F`;
    if (nextFloorEl) nextFloorEl.textContent = `${floor + 1}F`;
    if (teamLevelEl) teamLevelEl.textContent = String(teamLevel);
    if (profileProgress) profileProgress.style.width = `${progress}%`;
    if (partyCount) partyCount.textContent = String(cats);
    if (enemyCount) enemyCount.textContent = String(enemies);
    if (expeditionStatus) expeditionStatus.textContent = game.guardian ? 'ボス戦闘中' : '自動戦闘中';
    if (eventState) eventState.textContent = `現在 ${floor}F・最高 ${maxFloor}F`;

    updateActionAvailability(game);
    shell.dataset.runtimeReady = 'true';
    return true;
  }

  function waitForGame(attempt = 0) {
    if (mirrorGameState()) {
      window.clearInterval(mirrorTimer);
      mirrorTimer = window.setInterval(mirrorGameState, 250);
      mountActualStateRenderer();
      window.__s02Runtime = Object.freeze({
        ready: true,
        version: 'runtime-integration-round-001',
        source: 'window.__game',
        productionChanged: false
      });
      return;
    }
    if (attempt >= 120) {
      shell.dataset.runtimeReady = 'error';
      showToast('ゲーム状態の初期化に失敗しました');
      return;
    }
    window.setTimeout(() => waitForGame(attempt + 1), 50);
  }

  window.addEventListener('pagehide', () => {
    window.clearInterval(mirrorTimer);
    window.clearTimeout(toastTimer);
  });

  shell.dataset.runtimeReady = 'false';
  waitForGame();
})();
