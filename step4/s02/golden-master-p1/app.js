(() => {
  'use strict';

  const gmSpecs = [
    { id: 'GM01', width: 390, height: 844, battleHeight: 432, density: 'standard', state: 'normal', title: '390 × 844 · 通常戦闘の標準状態', caption: '390 × 844 CSS px · 標準状態 · 代表設計データ' },
    { id: 'GM02', width: 320, height: 667, battleHeight: 312, density: 'compact', state: 'normal', title: '320 × 667 · 狭幅の再構成', caption: '320 × 667 CSS px · 補助装飾を減らし、戦闘と44 px操作領域を維持' },
    { id: 'GM03', width: 375, height: 667, battleHeight: 320, density: 'compact', state: 'normal', title: '375 × 667 · 標準幅・低い画面', caption: '375 × 667 CSS px · 情報階層を保った低高さ構成' },
    { id: 'GM04', width: 320, height: 568, battleHeight: 300, density: 'short', state: 'normal', title: '320 × 568 · 短い画面のstress状態', caption: '320 × 568 CSS px · 戦場300 pxを確保し、商会詳細を先に省略' },
    { id: 'GM05', width: 430, height: 932, battleHeight: 480, density: 'tall', state: 'normal', title: '430 × 932 · 縦長・大型画面', caption: '430 × 932 CSS px · UIを巨大化せず、戦場と背景の奥行きを拡張' },
    { id: 'GM06', width: 390, height: 844, battleHeight: 432, density: 'standard', state: 'reward', title: '390 × 844 · 攻撃、被弾、撃破、報酬', caption: '390 × 844 CSS px · 動作軌跡、命中、敵反応、報酬を同じ因果線上に表示' },
    { id: 'GM07', width: 390, height: 844, battleHeight: 432, density: 'standard', state: 'offline', title: '390 × 844 · 放置復帰 reconciliation', caption: '390 × 844 CSS px · 算定中と確定後を分けた放置復帰状態' },
    { id: 'GM08', width: 390, height: 844, battleHeight: 432, density: 'standard', state: 'roster', title: '390 × 844 · 4枠編成の状態差', caption: '390 × 844 CSS px · 出撃、所有、加入可能、未解放を文言と形で識別' }
  ];

  const responsiveEvidenceVariants = {
    '360x800': { id: 'RV360', width: 360, height: 800, battleHeight: 360, density: 'standard', title: '360 × 800 · responsive acceptance', caption: '360 × 800 CSS px · 標準幅で戦場352 px以上を維持' },
    '412x915': { id: 'RV412', width: 412, height: 915, battleHeight: 412, density: 'tall', title: '412 × 915 · responsive acceptance', caption: '412 × 915 CSS px · 縦長領域を戦場へ配分' }
  };

  const catData = [
    { name: 'ムギ', role: '前衛制御', x: '41%', y: '7%', artX: '0%' },
    { name: 'ルナ', role: '遠隔対空', x: '17%', y: '16%', artX: '33.333%' },
    { name: 'トト', role: '回復支援', x: '28%', y: '25%', artX: '66.667%' },
    { name: 'コハク', role: '後衛撹乱', x: '49%', y: '28%', artX: '100%' }
  ];

  const iconPaths = {
    tower: '<path d="M8 21V9h8v12M6 9h12l-1-4h-3V3h-4v2H7L6 9Z"/><path d="M10 21v-5h4v5M9 12h2M13 12h2"/>',
    auto: '<path d="M6.2 7.2A7 7 0 0 1 18 9h2.5l-3.2 3.2L14 9h2.2a5 5 0 1 0 .8 6.2"/><path d="M8 12h8"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.4a4 4 0 1 0 0 5.2M8.5 12h5"/>',
    gem: '<path d="m12 3 7 6-7 12L5 9l7-6Z"/><path d="m5 9 7 3 7-3M12 3v9"/>',
    shield: '<path d="M12 3 19 6v5.4c0 4.2-2.8 7.5-7 9.6-4.2-2.1-7-5.4-7-9.6V6l7-3Z"/><path d="m9 12 2 2 4-5"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    party: '<path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20v-2.2c0-3 2.4-5.3 5.5-5.3s5.5 2.3 5.5 5.3V20H3Z"/><path d="M15 5.2a3 3 0 0 1 0 5.6M15.5 13c3 0 5.5 1.9 5.5 4.8V20h-4"/>',
    wagon: '<path d="M3 7h11v9H3V7ZM14 10h3l3 3v3h-6v-6Z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M6 4h9"/>',
    sword: '<path d="m5 19 4-4M7 21l-4-4 2-2 4 4-2 2ZM9 15l8.5-11.5 3 3L9 15Z"/><path d="m14 16 4 4M16 14l5 5-2 2-5-5 2-2Z"/>',
    bag: '<path d="M7 8h10l2 12H5L7 8Z"/><path d="M9 8a3 3 0 0 1 6 0M9 13h6"/>',
    chart: '<path d="M4 20V5M4 20h16M8 16l3-4 3 2 5-7"/>',
    menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7v.2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    join: '<path d="M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20v-2c0-3 2.2-5 5-5 1.5 0 2.8.5 3.7 1.4M17 12v8M13 16h8"/>',
    hit: '<path d="m12 2 1.7 6.3L19 5l-3.3 5.3L22 12l-6.3 1.7L19 19l-5.3-3.3L12 22l-1.7-6.3L5 19l3.3-5.3L2 12l6.3-1.7L5 5l5.3 3.3L12 2Z"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>'
  };

  function icon(name, className = '') {
    return `<svg class="ui-icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.info}</svg>`;
  }

  function partyStates(spec) {
    if (spec.state !== 'roster') {
      return catData.map(() => ({ key: 'field', label: '出撃中', icon: 'check' }));
    }
    return [
      { key: 'field', label: '出撃中', icon: 'check' },
      { key: 'owned', label: '所有済み', icon: 'wait' },
      { key: 'available', label: '加入可能', icon: 'join' },
      { key: 'locked', label: '未解放', icon: 'lock' }
    ];
  }

  function renderCats(spec) {
    const visible = spec.state === 'roster' ? [0] : [0, 1, 2, 3];
    return visible.map((index) => {
      const cat = catData[index];
      const actionClass = spec.state === 'reward' && index === 3 ? ' is-striking' : '';
      return `
        <div class="battle-cat cat-${index}${actionClass}" data-cat-id="character.launch.00${index + 1}" style="--cat-left:${cat.x};--cat-bottom:${cat.y};--cat-art-x:${cat.artX}">
          <span class="unit-life"><span style="width:${index === 0 ? 82 : 100}%"></span></span>
          <span class="cat-art" aria-hidden="true"></span>
          <span class="unit-label">${cat.name}</span>
        </div>`;
    }).join('');
  }

  function renderThreat(spec) {
    const hp = spec.state === 'reward' ? 0 : spec.state === 'offline' ? 44 : 62;
    return `
      <div class="threat-panel">
        <div class="threat-heading">
          <span class="enemy-rank">通常敵</span>
          <strong>ススイタチ</strong>
          <span class="threat-tag">${icon('target')}後衛狙い</span>
        </div>
        <div class="enemy-hp" aria-label="敵HP ${hp}パーセント">
          <span class="hp-label">HP</span>
          <span class="hp-track"><span style="width:${hp}%"></span></span>
          <span class="hp-value">${hp}%</span>
        </div>
      </div>`;
  }

  function renderBattleEffects(spec) {
    if (spec.state !== 'reward') return '';
    return `
      <div class="motion-trail" aria-hidden="true"></div>
      <div class="impact-burst" aria-hidden="true">${icon('hit')}</div>
      <div class="damage-number"><span>1,284</span><small>CRITICAL</small></div>
      <div class="reward-float">${icon('coin')}<strong>+9 G</strong></div>
      <div class="defeat-dust" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>`;
  }

  function renderBattle(spec) {
    const progress = spec.state === 'reward' ? 98 : 95;
    const progressText = spec.state === 'reward' ? '59 / 60' : '57 / 60';
    const objective = spec.state === 'roster' ? '編成状態を確認' : 'あと3体で27階へ';
    return `
      <section class="battle-region" data-testid="battlefield" aria-label="26階の通常戦闘">
        <div class="tower-scene" aria-hidden="true"></div>
        <div class="battle-vignette" aria-hidden="true"></div>
        <div class="battle-header">
          <div class="floor-marker">
            <span class="floor-emblem">${icon('tower')}</span>
            <span><small>無限塔 · 月影回廊</small><strong>26階</strong></span>
          </div>
          <div class="battle-objective">
            <small>現在の目標</small>
            <strong>${objective}</strong>
          </div>
          <div class="auto-chip">${icon('auto')}<span>AUTO</span><b>ON</b></div>
        </div>
        ${renderThreat(spec)}
        <div class="battle-field">
          <div class="distant-banner" aria-hidden="true"></div>
          <div class="floor-light" aria-hidden="true"></div>
          ${renderCats(spec)}
          <div class="enemy-unit${spec.state === 'reward' ? ' is-defeated' : ''}" data-enemy="enemy.normal.002">
            <span class="enemy-shadow" aria-hidden="true"></span>
            <img src="./assets/clockwork-marten.webp" alt="" aria-hidden="true">
          </div>
          ${renderBattleEffects(spec)}
        </div>
        <div class="floor-progress">
          <span>${icon('target')}階層制圧</span>
          <span class="progress-track"><span style="width:${progress}%"></span></span>
          <strong>${progressText}</strong>
        </div>
      </section>`;
  }

  function renderCombatRibbon(spec) {
    if (spec.state === 'reward') {
      return `
        <div class="combat-ribbon reward-ribbon" aria-label="コハクの攻撃が命中し、敵を撃破して9ゴールドを獲得">
          <span>${icon('sword')}<strong>コハクの一撃</strong></span>
          <span class="ribbon-step">命中</span>
          <span class="ribbon-line" aria-hidden="true"></span>
          <span class="ribbon-step">撃破</span>
          <span class="ribbon-line" aria-hidden="true"></span>
          <span class="ribbon-step reward-step">${icon('coin')}+9 G</span>
        </div>`;
    }
    if (spec.state === 'offline') {
      return `<div class="combat-ribbon"><span>${icon('clock')}<strong>前回の戦闘記録</strong></span><span>照合中</span></div>`;
    }
    if (spec.state === 'roster') {
      return `<div class="combat-ribbon roster-ribbon"><span>${icon('info')}<strong>戦場にいるのはムギのみ</strong></span><span>状態を確認</span></div>`;
    }
    return `<div class="combat-ribbon"><span>${icon('shield')}<strong>ムギが敵を引き止めています</strong></span><span>残り3体</span></div>`;
  }

  function renderParty(spec) {
    const states = partyStates(spec);
    const fieldCount = spec.state === 'roster' ? 1 : 4;
    return `
      <section class="party-dock" aria-label="4枠編成">
        <div class="dock-heading">
          <span>${icon('party')}<strong>編成</strong><b>${fieldCount} / 4 出撃</b></span>
          <small>${spec.state === 'roster' ? '状態は色と文言で区別' : '常設4枠'}</small>
        </div>
        <div class="party-cards">
          ${catData.map((cat, index) => {
            const status = states[index];
            return `
              <div class="party-card state-${status.key}" aria-label="${cat.name}、${status.label}、${cat.role}">
                <div class="portrait" style="--cat-art-x:${cat.artX}">
                  <span class="portrait-art" aria-hidden="true"></span>
                  <span class="status-mark">${icon(status.icon)}</span>
                </div>
                <span class="party-copy"><strong>${cat.name}</strong><small>${cat.role}</small></span>
                <span class="party-state">${status.label}</span>
              </div>`;
          }).join('')}
        </div>
      </section>`;
  }

  function renderAction(spec) {
    const label = spec.state === 'roster' ? '編成状態を整える' : '編成を整える';
    return `
      <div class="primary-action ui-control" aria-hidden="true">
        <span>${icon('party')}<span><small>次にできること</small><strong>${label}</strong></span></span>
        ${icon('arrow')}
      </div>`;
  }

  function renderSupport() {
    return `
      <aside class="support-strip" aria-label="商会の戦闘支援">
        <span class="support-icon">${icon('wagon')}</span>
        <span class="support-copy"><small>商会支援 · 配送中</small><strong>次の補給まで 02:18</strong></span>
        <span class="support-detail ui-control" aria-hidden="true">詳細${icon('chevron')}</span>
      </aside>`;
  }

  function renderNav() {
    const items = [
      ['sword', '戦闘', true],
      ['party', '編成', false],
      ['bag', '商会', false],
      ['chart', '塔記録', false],
      ['menu', 'その他', false]
    ];
    return `
      <nav class="bottom-nav" data-testid="bottom-nav" aria-label="主要ナビゲーション">
        ${items.map(([iconName, label, selected]) => `
          <span class="nav-item${selected ? ' is-selected' : ''}"${selected ? ' aria-current="page"' : ''}>
            <span class="nav-icon">${icon(iconName)}</span><small>${label}</small>
          </span>`).join('')}
      </nav>`;
  }

  function renderOfflineModal(spec) {
    if (spec.state !== 'offline') return '';
    return `
      <div class="reconcile-layer" role="img" aria-label="放置進行を照合中。結果はまだ確定していません">
        <div class="reconcile-modal">
          <span class="modal-ornament" aria-hidden="true"></span>
          <div class="modal-icon">${icon('clock')}</div>
          <p class="modal-kicker">OFFLINE RECONCILIATION</p>
          <h2>放置進行を照合中</h2>
          <p class="modal-intro">前回記録から <strong>4時間32分</strong><br>戦闘記録と報酬を順番に確認しています。</p>
          <dl class="reconcile-list">
            <div><dt>到達階</dt><dd><span class="pending-dot"></span>照合中</dd></div>
            <div><dt>獲得コイン</dt><dd><span class="pending-dot"></span>算定中</dd></div>
          </dl>
          <div class="reconcile-progress" aria-hidden="true"><span></span></div>
          <p class="pending-note">保存前 · 受取操作なし</p>
          <div class="modal-disabled ui-control" aria-hidden="true">照合完了後に確認</div>
        </div>
      </div>`;
  }

  function renderHud() {
    return `
      <header class="game-hud">
        <div class="profile-chip" aria-label="塔商会、ランク18">
          <span class="profile-mark">CT</span>
          <span><small>塔商会</small><strong><span class="rank-full">RANK 18</span><span class="rank-compact" aria-hidden="true">R18</span></strong></span>
        </div>
        <div class="resource-row">
          <span class="resource-chip coin-resource">${icon('coin')}<span><small>所持金</small><strong>12,480</strong></span></span>
          <span class="resource-chip gem-resource">${icon('gem')}<span><small>ルビー</small><strong>86</strong></span></span>
        </div>
      </header>`;
  }

  function renderGameScreen(spec, preview = false) {
    const article = document.createElement('article');
    article.className = `gm-screen density-${spec.density} state-${spec.state}${preview ? ' is-preview' : ''}`;
    if (!preview) article.dataset.testid = 'gm-stage';
    article.dataset.gm = spec.id;
    article.style.setProperty('--screen-width', `${spec.width}px`);
    article.style.setProperty('--screen-height', `${spec.height}px`);
    article.style.setProperty('--battle-height', `${spec.battleHeight}px`);
    article.style.width = `${spec.width}px`;
    article.style.height = `${spec.height}px`;
    article.setAttribute('aria-label', `${spec.id} ${spec.title}。デザインレビューであり実ゲームではありません`);
    article.innerHTML = `
      <div class="in-screen-review"><strong>DESIGN REVIEW</strong><span>${spec.id} · S02 GOLDEN MASTER</span><b>NOT RUNTIME</b></div>
      ${renderHud()}
      ${renderBattle(spec)}
      ${renderCombatRibbon(spec)}
      ${renderParty(spec)}
      ${renderAction(spec)}
      ${renderSupport()}
      <div class="screen-flex-spacer" aria-hidden="true"></div>
      ${renderNav()}
      ${renderOfflineModal(spec)}
    `;
    if (preview) {
      article.setAttribute('inert', '');
      article.setAttribute('aria-hidden', 'true');
      article.querySelectorAll('[data-testid], [data-cat-id], [data-enemy]').forEach((node) => {
        node.removeAttribute('data-testid');
        node.removeAttribute('data-cat-id');
        node.removeAttribute('data-enemy');
      });
    }
    return article;
  }

  const query = new URLSearchParams(window.location.search);
  const requestedId = (query.get('gm') || 'GM01').toUpperCase();
  const captureMode = query.get('capture') === '1';
  let activeSpec = gmSpecs.find((item) => item.id === requestedId) || gmSpecs[0];
  const requestedViewport = query.get('viewport');
  if (captureMode && responsiveEvidenceVariants[requestedViewport]) {
    activeSpec = { ...activeSpec, ...responsiveEvidenceVariants[requestedViewport] };
  }
  let fitMode = true;

  const captureRoot = document.getElementById('capture-root');
  const reviewShell = document.getElementById('review-shell');

  if (captureMode) {
    document.body.classList.add('capture-mode');
    reviewShell.hidden = true;
    captureRoot.hidden = false;
    captureRoot.style.width = `${activeSpec.width}px`;
    captureRoot.style.height = `${activeSpec.height}px`;
    captureRoot.append(renderGameScreen(activeSpec));
    document.title = `${activeSpec.id} — S02 Golden Master — Not Runtime`;
    document.body.dataset.reviewReady = 'true';
    return;
  }

  const holder = document.getElementById('stage-holder');
  const scroller = document.getElementById('golden-master');
  const previewRoot = document.getElementById('comparison-preview');
  const fitButton = document.getElementById('fit-button');
  const actualButton = document.getElementById('actual-button');
  const tabs = [...document.querySelectorAll('[role="tab"][data-gm]')];

  function updateFit() {
    const stage = holder.querySelector('.gm-screen');
    if (!stage) return;
    const availableWidth = Math.max(0, scroller.clientWidth - 8);
    const scale = fitMode ? Math.min(1, availableWidth / activeSpec.width) : 1;
    stage.style.transform = `scale(${scale})`;
    holder.style.width = `${activeSpec.width * scale}px`;
    holder.style.height = `${activeSpec.height * scale}px`;
    holder.dataset.mode = fitMode ? 'fit' : 'actual';
  }

  function updatePreview() {
    previewRoot.replaceChildren();
    const stage = renderGameScreen(activeSpec, true);
    previewRoot.append(stage);
    requestAnimationFrame(() => {
      const maxWidth = previewRoot.clientWidth - 2;
      const maxHeight = previewRoot.clientHeight - 2;
      const scale = Math.min(maxWidth / activeSpec.width, maxHeight / activeSpec.height);
      stage.style.transform = `scale(${scale})`;
      stage.style.transformOrigin = 'top left';
      stage.style.left = `${Math.max(0, (maxWidth - activeSpec.width * scale) / 2)}px`;
      stage.style.top = `${Math.max(0, (maxHeight - activeSpec.height * scale) / 2)}px`;
    });
  }

  function selectSpec(id, moveFocus = false) {
    const found = gmSpecs.find((item) => item.id === id);
    if (!found) return;
    activeSpec = found;
    holder.replaceChildren(renderGameScreen(activeSpec));
    document.getElementById('selected-id').textContent = activeSpec.id;
    document.getElementById('selected-title').textContent = activeSpec.title;
    document.getElementById('stage-caption').textContent = activeSpec.caption;
    document.getElementById('compare-id').textContent = activeSpec.id;
    const singleLink = document.getElementById('single-link');
    singleLink.href = `?gm=${activeSpec.id}&capture=1`;
    tabs.forEach((tab) => {
      const selected = tab.dataset.gm === activeSpec.id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && moveFocus) tab.focus();
    });
    const nextQuery = new URLSearchParams(window.location.search);
    nextQuery.set('gm', activeSpec.id);
    nextQuery.delete('capture');
    history.replaceState(null, '', `${window.location.pathname}?${nextQuery.toString()}`);
    updateFit();
    updatePreview();
    document.getElementById('review-announcer').textContent = `${activeSpec.id}、${activeSpec.title}を表示しました`;
  }

  function setFitMode(nextFit) {
    fitMode = nextFit;
    fitButton.classList.toggle('is-selected', fitMode);
    actualButton.classList.toggle('is-selected', !fitMode);
    fitButton.setAttribute('aria-pressed', String(fitMode));
    actualButton.setAttribute('aria-pressed', String(!fitMode));
    updateFit();
  }

  tabs.forEach((tab, tabIndex) => {
    tab.addEventListener('click', () => selectSpec(tab.dataset.gm));
    tab.addEventListener('keydown', (event) => {
      let nextIndex = tabIndex;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (tabIndex + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      selectSpec(tabs[nextIndex].dataset.gm, true);
    });
  });

  fitButton.addEventListener('click', () => setFitMode(true));
  actualButton.addEventListener('click', () => setFitMode(false));
  window.addEventListener('resize', () => {
    updateFit();
    updatePreview();
  });

  selectSpec(activeSpec.id);
  document.body.dataset.reviewReady = 'true';
})();
