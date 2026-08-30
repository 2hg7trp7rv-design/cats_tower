(() => {
  'use strict';

  const shell = document.querySelector('[data-testid="s02-runtime-shell"]');
  if (!shell) return;

  const DATA = window.GAME_DATA;
  const byId = (id) => document.getElementById(id);
  const toast = byId('runtime-toast');
  const runtimeScroll = byId('runtime-scroll');
  const supportAnchor = byId('runtime-support-anchor');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const query = new URLSearchParams(window.location.search);
  const rosterJobIds = Array.isArray(DATA?.JOB_ORDER) ? DATA.JOB_ORDER.slice(0, 4) : [];

  let toastTimer = 0;
  let mirrorTimer = 0;
  let visualLayerMounted = false;
  let eventObserverMounted = false;
  let lastFeed = '猫たちは自動で接近し、射程に入ると攻撃します';
  let lastFeedTone = 'neutral';
  let lastFeedAt = 0;

  if (query.get('largeText') === '1') document.body.classList.add('runtime-large-text');

  function safeNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function format(value) {
    if (DATA && typeof DATA.fmt === 'function') return DATA.fmt(safeNumber(value));
    return String(Math.floor(safeNumber(value)));
  }

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

  function bindActionButton(button) {
    if (!button || button.dataset.runtimeBound === 'true') return;
    button.dataset.runtimeBound = 'true';
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') {
        performRuntimeAction(button.dataset.runtimeAction);
        return;
      }
      if (button.classList.contains('runtime-nav-button') && !button.classList.contains('is-pending')) {
        setActiveNav(button);
      }
      performRuntimeAction(button.dataset.runtimeAction);
    });
  }

  document.querySelectorAll('[data-runtime-action]').forEach(bindActionButton);
  byId('runtime-event-banner')?.addEventListener('click', () => performRuntimeAction('battle'));
  byId('runtime-next-target')?.addEventListener('click', () => performRuntimeAction('next'));

  const pendingEventsButton = document.querySelector('.runtime-nav-button[data-runtime-action="events"]');
  if (pendingEventsButton) {
    pendingEventsButton.removeAttribute('aria-disabled');
    pendingEventsButton.setAttribute('aria-label', '催事は制作中');
    pendingEventsButton.classList.add('is-pending');
  }

  function createElement(tag, className, attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    Object.entries(attributes).forEach(([name, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(name, String(value));
    });
    return element;
  }

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

  function mountVisualRepairLayer() {
    if (visualLayerMounted) return;
    const battle = byId('battle-wrap');
    const statusBar = byId('status-bar');
    if (!battle || !statusBar || !DATA) return;

    const encounter = createElement('section', 'runtime-encounter-panel', {
      'aria-label': '現在の戦闘目標',
      'data-testid': 'runtime-encounter-panel'
    });
    encounter.innerHTML = [
      '<span class="runtime-encounter-kind" id="runtime-encounter-kind">通常戦</span>',
      '<span class="runtime-encounter-copy"><strong id="runtime-objective-title">制圧進行</strong><small id="runtime-objective-detail">準備中</small></span>',
      '<span class="runtime-encounter-value" id="runtime-objective-value">0 / 0</span>',
      '<span class="runtime-encounter-meter" aria-hidden="true"><i id="runtime-objective-meter"></i></span>'
    ].join('');
    battle.appendChild(encounter);

    const feed = createElement('div', 'runtime-battle-feed', {
      id: 'runtime-battle-feed',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true'
    });
    feed.innerHTML = '<span class="runtime-feed-sigil" aria-hidden="true">⚔</span><span id="runtime-feed-text"></span>';
    battle.appendChild(feed);

    const partyDock = createElement('section', 'runtime-party-dock', {
      'aria-labelledby': 'runtime-party-dock-title',
      'data-testid': 'runtime-party-dock'
    });
    const partyHeading = createElement('header', 'runtime-party-dock-heading');
    partyHeading.innerHTML = [
      '<span><strong id="runtime-party-dock-title">常設編成</strong><small>4枠</small></span>',
      '<b id="runtime-party-summary">0 / 4</b>'
    ].join('');
    partyDock.appendChild(partyHeading);

    const partyGrid = createElement('div', 'runtime-party-grid');
    rosterJobIds.forEach((jobId, index) => {
      const job = DATA.JOBS?.[jobId];
      const asset = job ? DATA.ASSETS?.cats?.[job.sprite] : null;
      const button = createElement('button', 'runtime-party-slot', {
        type: 'button',
        'data-runtime-action': 'agency',
        'data-job-id': jobId,
        'aria-label': `${index + 1}枠 ${job?.name || '未設定'}の編成情報を開く`
      });
      const portrait = createElement('span', 'runtime-party-portrait', { 'aria-hidden': 'true' });
      if (asset?.src) {
        const image = document.createElement('img');
        image.src = asset.src;
        image.alt = '';
        portrait.appendChild(image);
      } else {
        portrait.textContent = '＋';
      }
      const copy = createElement('span', 'runtime-party-slot-copy');
      copy.innerHTML = `<strong>${job?.name || '未設定'}</strong><small>${job?.role || '編成枠'}</small>`;
      const state = createElement('b', 'runtime-party-slot-state');
      state.textContent = '確認中';
      button.append(portrait, copy, state);
      bindActionButton(button);
      partyGrid.appendChild(button);
    });
    partyDock.appendChild(partyGrid);
    battle.appendChild(partyDock);

    const causality = createElement('section', 'runtime-causality-strip', {
      'aria-label': '接敵、攻撃、報酬の因果',
      'data-testid': 'runtime-causality-strip'
    });
    causality.innerHTML = [
      '<div><span>接敵</span><strong id="runtime-contact-state">接近中</strong><small id="runtime-contact-detail">前線を確認中</small></div>',
      '<div><span>次の攻撃</span><strong id="runtime-attack-state">AUTO</strong><small id="runtime-attack-detail">攻撃周期を確認中</small></div>',
      '<div><span>制圧報酬</span><strong id="runtime-reward-state">+0G</strong><small id="runtime-reward-detail">撃破で獲得</small></div>'
    ].join('');
    statusBar.insertAdjacentElement('beforebegin', causality);

    visualLayerMounted = true;
    shell.dataset.visualLayerReady = 'true';
  }

  function updateFeed(message, tone = 'neutral') {
    lastFeed = message;
    lastFeedTone = tone;
    lastFeedAt = performance.now();
    const feed = byId('runtime-battle-feed');
    const text = byId('runtime-feed-text');
    if (text) text.textContent = message;
    if (feed) feed.dataset.tone = tone;
  }

  function eventMessage(type, data = {}) {
    switch (type) {
      case 'summon': return [`増援 ${safeNumber(data.count, 1)}体が前線へ出発`, 'positive'];
      case 'auto-spawn': return [`自動増援 ${safeNumber(data.count, 1)}体を派遣`, 'neutral'];
      case 'hit': return [`${DATA.JOBS?.[data.jobId]?.name || '仲間'}が ${format(data.dmg)} ダメージ`, 'impact'];
      case 'cat-faint': return [`${DATA.JOBS?.[data.jobId]?.name || '仲間'}が被弾し後退`, 'warning'];
      case 'add-down': return [`敵を撃破・+${format(data.coin)}G`, 'reward'];
      case 'floor-clear': return [`${safeNumber(data.floor, 1)}Fを制圧・+${format(data.coin)}G`, 'reward'];
      case 'floor-enter': return [data.boss ? `${safeNumber(data.floor, 1)}F ボス戦へ突入` : `${safeNumber(data.floor, 1)}Fへ自動進軍`, data.boss ? 'warning' : 'neutral'];
      case 'income': return [`店舗収益 +${format(data.perSec)}G/秒`, 'positive'];
      default: return null;
    }
  }

  function observeActualEvents(game) {
    if (eventObserverMounted || !game || typeof game.emit !== 'function') return;
    const patchKey = '__s02VisualRepairOriginalEmit';
    if (game[patchKey]) {
      eventObserverMounted = true;
      return;
    }
    const originalEmit = game.emit;
    Object.defineProperty(game, patchKey, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: originalEmit
    });
    game.emit = function emitWithVisualObservation(type, data) {
      const result = originalEmit.call(this, type, data);
      const detail = Object.assign({ type, observedAt: performance.now() }, data || {});
      const message = eventMessage(type, detail);
      if (message) updateFeed(message[0], message[1]);
      window.dispatchEvent(new CustomEvent('cats-tower:s02-event', { detail }));
      return result;
    };
    eventObserverMounted = true;
    shell.dataset.actualEventObserver = 'true';
  }

  function updateActionAvailability(game) {
    document.querySelectorAll('[data-runtime-action="forge"]').forEach((button) => {
      const ready = typeof game.weaponRank === 'function' && game.weaponRank() > 0;
      button.setAttribute('aria-disabled', String(!ready));
    });
    document.querySelectorAll('[data-runtime-action="item"]').forEach((button) => {
      const ready = typeof game.itemRank === 'function' && game.itemRank() > 0;
      button.setAttribute('aria-disabled', String(!ready));
    });

    const returnButton = byId('btn-dawn');
    const returnState = byId('runtime-return-state');
    if (returnState) returnState.textContent = returnButton && !returnButton.disabled ? '可能' : '条件未達';
  }

  function updateEncounter(game) {
    const guardian = game.guardian || null;
    const boss = Boolean(guardian);
    const current = boss ? Math.max(0, safeNumber(guardian.hp)) : Math.max(0, safeNumber(game.kills));
    const maximum = boss ? Math.max(1, safeNumber(guardian.maxHp, 1)) : Math.max(1, safeNumber(game.killNeed, 1));
    const ratio = boss ? 1 - current / maximum : current / maximum;
    const encounterKind = byId('runtime-encounter-kind');
    const title = byId('runtime-objective-title');
    const detail = byId('runtime-objective-detail');
    const value = byId('runtime-objective-value');
    const meter = byId('runtime-objective-meter');
    const panel = document.querySelector('.runtime-encounter-panel');

    if (encounterKind) encounterKind.textContent = boss ? 'BOSS' : '制圧戦';
    if (title) title.textContent = boss ? `${game.floor}F 階層主決戦` : `${game.floor}F 撃破目標`;
    if (detail) detail.textContent = boss ? 'HPを削り切ると階層制圧' : '規定数を倒すと次階へ自動進軍';
    if (value) value.textContent = boss ? `${format(current)} / ${format(maximum)}` : `${Math.floor(current)} / ${Math.floor(maximum)}`;
    if (meter) meter.style.width = `${Math.max(3, Math.min(100, ratio * 100))}%`;
    if (panel) panel.dataset.mode = boss ? 'boss' : 'normal';
  }

  function updatePartyDock(game) {
    let ownedSlots = 0;
    const totalLevel = typeof game.totalJobLv === 'function' ? safeNumber(game.totalJobLv(), 1) : 1;
    const actualCats = Array.isArray(game.fieldCats) ? game.fieldCats : [];

    document.querySelectorAll('.runtime-party-slot').forEach((slot) => {
      const jobId = slot.dataset.jobId;
      const job = DATA.JOBS?.[jobId];
      const owned = safeNumber(game.jobs?.[jobId]?.owned) > 0;
      const level = safeNumber(game.jobs?.[jobId]?.lv);
      const onField = actualCats.some((cat) => cat.jobId === jobId && cat.state !== 'faint');
      const unlocked = job ? totalLevel >= safeNumber(job.unlockTotalLv) : false;
      const state = slot.querySelector('.runtime-party-slot-state');
      const copySmall = slot.querySelector('.runtime-party-slot-copy small');
      slot.classList.toggle('is-owned', owned);
      slot.classList.toggle('is-on-field', onField);
      slot.classList.toggle('is-available', !owned && unlocked);
      slot.classList.toggle('is-locked', !owned && !unlocked);
      if (owned) ownedSlots += 1;

      if (state) {
        state.textContent = onField ? '戦闘中' : owned ? '編成済' : unlocked ? '加入可' : `Lv${job?.unlockTotalLv || 0}`;
      }
      if (copySmall) copySmall.textContent = owned ? `Lv.${Math.max(1, level)}・${job?.role || ''}` : job?.role || '編成枠';
      slot.setAttribute('aria-label', owned
        ? `${job?.name || jobId} レベル${Math.max(1, level)} ${onField ? '戦闘中' : '編成済み'}。編成情報を開く`
        : unlocked
          ? `${job?.name || jobId} 加入可能。仲間画面を開く`
          : `${job?.name || jobId} 合計レベル${job?.unlockTotalLv || 0}で解放`);
    });

    const summary = byId('runtime-party-summary');
    if (summary) summary.textContent = `${ownedSlots} / 4`;
    shell.dataset.partySlotCount = '4';
    shell.dataset.ownedPartySlots = String(ownedSlots);
  }

  function updateCausality(game) {
    const cats = Array.isArray(game.fieldCats) ? game.fieldCats : [];
    const fighting = cats.filter((cat) => cat.state === 'fight');
    const walking = cats.filter((cat) => cat.state === 'walk');
    const enemy = typeof game.nearestEnemy === 'function' ? game.nearestEnemy() : null;

    const contactState = byId('runtime-contact-state');
    const contactDetail = byId('runtime-contact-detail');
    if (contactState) contactState.textContent = fighting.length ? `接敵 ${fighting.length}体` : walking.length ? '接近中' : '増援待ち';
    if (contactDetail) {
      contactDetail.textContent = fighting.length
        ? `敵 ${Array.isArray(game.enemies) ? game.enemies.length : 0}体へ攻撃中`
        : walking.length
          ? `増援 ${walking.length}体が移動中`
          : 'にゃんこ招集で前線を補強';
    }

    const liveCats = cats.filter((cat) => cat.state !== 'faint');
    let nextAttack = Infinity;
    liveCats.forEach((cat) => {
      if (typeof game.catInterval !== 'function') return;
      const interval = Math.max(0.01, safeNumber(game.catInterval(cat.jobId), 1));
      const remaining = cat.state === 'fight' ? Math.max(0, interval - safeNumber(cat.atkT)) : interval;
      nextAttack = Math.min(nextAttack, remaining);
    });
    const attackState = byId('runtime-attack-state');
    const attackDetail = byId('runtime-attack-detail');
    if (attackState) attackState.textContent = Number.isFinite(nextAttack) ? `${nextAttack.toFixed(1)}秒` : 'AUTO';
    if (attackDetail) {
      const multiplier = enemy && typeof game.elementMult === 'function' ? safeNumber(game.elementMult(enemy), 1) : 1;
      attackDetail.textContent = multiplier > 1 ? '弱点属性・与ダメージ増加' : multiplier < 1 ? '耐性属性・武器見直し推奨' : '自動攻撃・等倍';
    }

    const boss = Boolean(game.guardian);
    const reward = boss
      ? safeNumber(DATA.floorCoins?.(game.floor)) * safeNumber(game.coinMult?.(), 1)
      : safeNumber(DATA.addCoins?.(game.floor)) * safeNumber(game.coinMult?.(), 1);
    const rewardState = byId('runtime-reward-state');
    const rewardDetail = byId('runtime-reward-detail');
    if (rewardState) rewardState.textContent = `+${format(reward)}G`;
    if (rewardDetail) rewardDetail.textContent = boss ? '階層主撃破時' : '敵1体の撃破時';

    const feed = byId('runtime-battle-feed');
    if (feed && performance.now() - lastFeedAt > 4200) {
      const fallback = fighting.length
        ? `${fighting.length}体が接敵・敵HPを自動で削っています`
        : walking.length
          ? `${walking.length}体が前線へ接近中`
          : '増援を招集すると実際の戦場へ出撃します';
      if (fallback !== lastFeed) updateFeed(fallback, 'neutral');
    }

    shell.dataset.contactState = fighting.length ? 'fight' : walking.length ? 'walk' : 'idle';
    shell.dataset.actualFieldCatCount = String(cats.length);
    shell.dataset.actualEnemyCount = String(Array.isArray(game.enemies) ? game.enemies.length : 0);
    shell.dataset.visualCausalityReady = 'true';
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
    if (expeditionStatus) expeditionStatus.textContent = game.guardian ? '階層主と交戦中' : '自動戦闘中';
    if (eventState) eventState.textContent = `現在 ${floor}F・最高 ${maxFloor}F`;

    updateActionAvailability(game);
    updateEncounter(game);
    updatePartyDock(game);
    updateCausality(game);
    shell.dataset.runtimeReady = 'true';
    return true;
  }

  function waitForGame(attempt = 0) {
    const game = getGame();
    if (game) {
      mountVisualRepairLayer();
      observeActualEvents(game);
      mountActualStateRenderer();
      updateFeed(lastFeed, lastFeedTone);
      mirrorGameState();
      window.clearInterval(mirrorTimer);
      mirrorTimer = window.setInterval(mirrorGameState, 120);
      window.__s02Runtime = Object.freeze({
        ready: true,
        version: 's02-visual-repair-round-001',
        source: 'window.__game',
        eventSource: 'window.__game.emit observer',
        partySlots: 4,
        gameplayCoreChanged: false,
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
  shell.dataset.visualLayerReady = 'false';
  waitForGame();
})();
