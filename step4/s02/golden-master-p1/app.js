(() => {
  'use strict';

  const gmSpecs = {
    GM01: { state: 'normal', title: '390 × 844 基準 · 通常戦闘の標準状態' },
    GM02: { state: 'normal', title: '320 × 667 · 狭幅の再構成' },
    GM03: { state: 'normal', title: '375 × 667 · 低い標準幅' },
    GM04: { state: 'normal', title: '320 × 568 · 短い画面のstress状態' },
    GM05: { state: 'normal', title: '430 × 932 · 縦長の戦場拡張' },
    GM06: { state: 'reward', title: '攻撃、被弾、撃破、報酬の因果' },
    GM07: { state: 'offline', title: '放置復帰 · 未確定の照合状態' },
    GM08: { state: 'roster', title: '出撃、所有、加入可能、未解放' }
  };

  const offlineViewStates = {
    NO_PROGRESS: {
      label: '放置収益なし',
      description: '確認対象となる放置収益はありません（上限12時間）。',
      elapsedSeconds: 0,
      rows: [],
      progress: 'none',
      note: '放置収益なし · 保存値は変更しません',
      actions: ['close']
    },
    ELAPSED_UNKNOWN: {
      label: '経過時間確認中',
      description: '前回記録からの経過時間を確認中です（上限12時間）。',
      elapsedSeconds: null,
      rows: [],
      progress: 'indeterminate',
      note: '経過時間確認中 · 報酬額は表示しません',
      actions: ['close']
    },
    RECONCILING_INDETERMINATE: {
      label: '照合中',
      description: '前回記録から4時間32分（上限12時間）。進行率を使わず照合しています。',
      elapsedSeconds: 16320,
      rows: [],
      progress: 'indeterminate',
      note: '照合中 · 報酬額はまだ表示しません',
      actions: ['close']
    },
    RECONCILING_DETERMINATE: {
      label: '照合中',
      description: '前回記録から4時間32分（上限12時間）。確認済み進行率で照合しています。',
      elapsedSeconds: 16320,
      rows: [],
      progress: 'determinate',
      progressValue: 64,
      note: '照合中 · 報酬額はまだ表示しません',
      actions: ['close']
    },
    PROVISIONAL: {
      label: '見込み',
      description: '前回記録から4時間32分（上限12時間）。結果はまだ確定していません。',
      elapsedSeconds: 16320,
      rows: [['獲得コイン', '見込み 1,840']],
      progress: 'none',
      note: '見込み · 未受取 · 所持金へ未反映',
      actions: ['close']
    },
    CONFIRMING: {
      label: '照合中',
      description: '前回記録から4時間32分（上限12時間）。戦闘記録と報酬はまだ未確定です。',
      elapsedSeconds: 16320,
      rows: [['獲得コイン', '見込み 1,840']],
      progress: 'indeterminate',
      note: '照合中 · 未受取 · 受取操作なし',
      actions: ['close']
    },
    CONFIRMED: {
      label: '確定',
      description: '前回記録から4時間32分（上限12時間）。照合済みの結果です。',
      elapsedSeconds: 16320,
      rows: [['獲得コイン', '確定 1,840']],
      progress: 'none',
      note: '確定 · 同一settlementの重複反映なし',
      actions: ['close', 'continue']
    },
    REJECTED: {
      label: '付与なし',
      description: '前回記録から4時間32分（上限12時間）。今回の記録には付与対象がありません。',
      elapsedSeconds: 16320,
      rows: [],
      progress: 'none',
      note: '付与なし · 所持金は変更しません',
      actions: ['close', 'continue']
    },
    RETRYABLE_ERROR: {
      label: '再確認が必要',
      description: '前回記録から4時間32分（上限12時間）。照合を完了できませんでした。',
      elapsedSeconds: 16320,
      rows: [['獲得コイン', '見込み 1,840']],
      progress: 'none',
      note: '再確認が必要 · 重複付与なし',
      actions: ['close', 'retry'],
      retryCapability: true
    },
    UNKNOWN: {
      label: '状態確認中',
      description: '前回記録の状態を確認中です（上限12時間）。報酬額は表示しません。',
      elapsedSeconds: null,
      rows: [],
      progress: 'indeterminate',
      note: '状態確認中 · 操作可否も確定していません',
      actions: ['close']
    }
  };

  const cats = [
    { id: 'character.launch.001', name: 'ムギ', role: '前衛制御', frame: 'party.roster.mugi', actionFrame: 'party.action.mugi', position: '0%', hpCurrent: 840, hpMax: 1000, hpDisplay: '840 / 1,000' },
    { id: 'character.launch.002', name: 'ルナ', role: '遠隔対空', frame: 'party.roster.luna', actionFrame: 'party.action.luna', position: '33.333333%', hpCurrent: 620, hpMax: 800, hpDisplay: '620 / 800' },
    { id: 'character.launch.003', name: 'トト', role: '回復支援', frame: 'party.roster.toto', actionFrame: 'party.action.toto', position: '66.666667%', hpCurrent: 710, hpMax: 760, hpDisplay: '710 / 760' },
    { id: 'character.launch.004', name: 'コハク', role: '後衛撹乱', frame: 'party.roster.kohaku', actionFrame: 'party.action.kohaku', position: '100%', hpCurrent: 540, hpMax: 700, hpDisplay: '540 / 700' }
  ];

  const iconPaths = {
    tower: '<path d="M7 21V9h10v12M5 9h14l-1-4h-4V3h-4v2H6L5 9Z"/><path d="M10 21v-5h4v5M9 12h2M13 12h2"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.4a4 4 0 1 0 0 5.2M8.5 12h5"/>',
    auto: '<path d="M6 7.5A7 7 0 0 1 18 9h2.5L17 12.5 13.5 9H16a5 5 0 1 0 1 6.1"/><path d="M8 12h8"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    shield: '<path d="M12 3 19 6v5.4c0 4.2-2.8 7.5-7 9.6-4.2-2.1-7-5.4-7-9.6V6l7-3Z"/><path d="m9 12 2 2 4-5"/>',
    wagon: '<path d="M3 7h11v9H3V7ZM14 10h3l3 3v3h-6v-6Z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M6 4h9"/>',
    party: '<path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20v-2.2c0-3 2.4-5.3 5.5-5.3s5.5 2.3 5.5 5.3V20H3Z"/><path d="M15 5.2a3 3 0 0 1 0 5.6M15.5 13c3 0 5.5 1.9 5.5 4.8V20h-4"/>',
    sword: '<path d="m5 19 4-4M7 21l-4-4 2-2 4 4-2 2ZM9 15l8.5-11.5 3 3L9 15Z"/><path d="m14 16 4 4M16 14l5 5-2 2-5-5 2-2Z"/>',
    bag: '<path d="M7 8h10l2 12H5L7 8Z"/><path d="M9 8a3 3 0 0 1 6 0M9 13h6"/>',
    chart: '<path d="M4 20V5M4 20h16M8 16l3-4 3 2 5-7"/>',
    menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    field: '<circle cx="8" cy="8" r="2"/><circle cx="5" cy="5" r="1"/><circle cx="10" cy="4.5" r="1"/><path d="M5.5 12c1.5-2 3.5-2 5 0M5 19 19 5"/><circle cx="16" cy="16" r="2"/><circle cx="13" cy="19.5" r="1"/><circle cx="19" cy="19" r="1"/><path d="M13.5 12c1.5 2 3.5 2 5 0"/>',
    chest: '<path d="M4 9h16v11H4V9ZM6 9V6h12v3M4 13h16"/><path d="M10 12h4v4h-4z"/>',
    door: '<path d="M5 21V4l12-2v19M5 21h14M13 12h.01"/><path d="M19 8v8M16 12h6"/>',
    wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    join: '<path d="M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20v-2c0-3 2.2-5 5-5 1.5 0 2.8.5 3.7 1.4M17 12v8M13 16h8"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    hit: '<path d="m12 2 1.7 6.3L19 5l-3.3 5.3L22 12l-6.3 1.7L19 19l-5.3-3.3L12 22l-1.7-6.3L5 19l3.3-5.3L2 12l6.3-1.7L5 5l5.3 3.3L12 2Z"/>'
  };

  function icon(name, className = '') {
    return `<svg class="ui-icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]}</svg>`;
  }

  function renderHud() {
    return `
      <header class="game-hud">
        <div class="company-mark" aria-label="月影隊">
          <span class="crest" aria-hidden="true">CT</span>
          <span><small>塔商会所属</small><strong>月影隊</strong></span>
        </div>
        <div class="resource-chip" data-currency="coin" data-binding="wallet.runCoin" data-currency-canonical-id="coin.run" data-amount-decimal="12480" aria-label="所持金 12480ゴールド">
          ${icon('coin')}<span><small>所持金</small><strong>12,480 G</strong></span>
        </div>
      </header>`;
  }

  function renderThreat(spec) {
    const hpCurrent = spec.state === 'reward' ? 0 : spec.state === 'roster' ? 10000 : 6200;
    const hpMax = 10000;
    const hpPercent = hpCurrent / hpMax * 100;
    const hpDisplay = `${hpCurrent.toLocaleString('ja-JP')} / ${hpMax.toLocaleString('ja-JP')}`;
    return `
      <div class="threat-card" data-binding="encounter.identity">
        <div class="threat-name"><span>通常敵</span><strong>ススイタチ</strong></div>
        <div class="enemy-hp" data-binding="enemy.hp" data-hp-current="${hpCurrent}" data-hp-max="${hpMax}"${spec.state === 'reward' ? ' data-hp-before="1284" data-hp-after="0"' : ''} role="progressbar" aria-label="敵HP ${hpDisplay}" aria-valuemin="0" aria-valuenow="${hpCurrent}" aria-valuemax="${hpMax}" aria-valuetext="${hpDisplay}">
          <span>HP</span><i><b style="width:${hpPercent}%"></b></i><strong>${hpDisplay}</strong>
        </div>
      </div>`;
  }

  function renderCats(spec) {
    const visible = spec.state === 'roster' ? cats.slice(0, 1) : cats;
    return visible.map((cat, index) => {
      const attacking = spec.state === 'reward' && index === 1;
      const asset = attacking ? 'assets/party-actions.webp' : 'assets/party-roster.webp';
      const frame = attacking ? cat.actionFrame : cat.frame;
      const striking = attacking ? ' is-striking' : '';
      const hpPercent = cat.hpCurrent / cat.hpMax * 100;
      return `
        <div class="battle-cat cat-${index}${striking}" data-cat-id="${cat.id}" data-binding="party.fieldEntity" data-target-entity-id="enemy.normal.002" data-foot-anchor-x="320" data-foot-anchor-y="720"${striking ? ' data-causality="attack-follow-through" data-effect-phase="follow-through"' : ''}>
          <span class="ally-hp" data-binding="party.allyHp" data-hp-current="${cat.hpCurrent}" data-hp-max="${cat.hpMax}" role="progressbar" aria-label="${cat.name} HP ${cat.hpDisplay}" aria-valuemin="0" aria-valuenow="${cat.hpCurrent}" aria-valuemax="${cat.hpMax}" aria-valuetext="${cat.hpDisplay}"><i style="width:${hpPercent}%"></i></span>
          <span class="cat-sprite${attacking ? ' uses-action' : ''}" data-asset-path="${asset}" data-frame-id="${frame}"${attacking ? ' data-binding="combat.attack" data-event-id="gm06.attack.001" data-event-type="combat.attack_started" data-simulation-tick="0" data-state-version="1" data-source-entity-id="character.launch.002" data-target-entity-id="enemy.normal.002" data-release-event-id="gm06.release.001" data-release-event-type="combat.attack_released" data-release-simulation-tick="220" data-release-state-version="2" data-release-source-entity-id="character.launch.002"' : ''} style="--frame-x:${cat.position}" aria-hidden="true"></span>
          <span class="unit-name">${cat.name}</span>
        </div>`;
    }).join('');
  }

  function renderEnemy(spec) {
    const rewardClass = spec.state === 'reward' ? ' is-hit is-defeated' : '';
    return `
      <div class="enemy-unit${rewardClass}" data-enemy="enemy.normal.002" data-enemy-kind="NORMAL" data-foot-anchor-x="657" data-foot-anchor-y="1023"${spec.state === 'reward' ? ' data-causality="hit-reaction" data-binding="combat.hit" data-event-id="gm06.hit.001" data-event-type="combat.entity_hit" data-simulation-tick="440" data-state-version="6" data-entity-id="enemy.normal.002" data-cause-event-id="gm06.damage.001"' : ''}>
        <span class="enemy-shadow" aria-hidden="true"></span>
        <img src="./assets/clockwork-marten.webp" data-asset-path="assets/clockwork-marten.webp" data-frame-id="enemy.clockwork-marten.idle" alt="" aria-hidden="true">
      </div>`;
  }

  function renderRewardEffects(spec) {
    if (spec.state !== 'reward') return '';
    return `
      <span class="projectile-path-residue" data-causality="projectile-path-residue" data-binding="combat.attack" data-event-id="gm06.projectile.001" data-event-type="combat.projectile_arrived" data-simulation-tick="390" data-state-version="4" data-projectile-entity-id="gm06.projectile.entity.001" data-source-entity-id="character.launch.002" data-target-entity-id="enemy.normal.002" data-attack-event-id="gm06.attack.001" data-spawn-event-id="gm06.spawn.001" data-spawn-event-type="combat.projectile_spawned" data-spawn-simulation-tick="220" data-spawn-state-version="3" data-spawn-projectile-entity-id="gm06.projectile.entity.001" data-spawn-source-entity-id="character.launch.002" data-spawn-target-entity-id="enemy.normal.002" data-spawn-attack-event-id="gm06.attack.001" aria-label="矢の軌跡の残像"></span>
      <span class="impact-residue" data-causality="impact-residue" data-binding="combat.damage" data-effect-clip="impact.residue" data-flash-active="false" data-arrival-event-id="gm06.projectile.001" data-damage-event-id="gm06.damage.001" data-target-entity-id="enemy.normal.002" data-target-anchor="hitTarget" aria-label="命中位置の残留痕"><i></i><i></i><i></i></span>
      <span class="damage-number" data-causality="damage" data-binding="combat.damage" data-event-id="gm06.damage.001" data-event-type="combat.damage_applied" data-simulation-tick="390" data-state-version="5" data-source-entity-id="character.launch.002" data-target-entity-id="enemy.normal.002" data-amount-decimal="1284" data-critical="false"><strong>1,284</strong><small>命中</small></span>
      <span class="defeat-dust" data-causality="defeat" data-binding="combat.defeat" data-event-id="gm06.defeat.001" data-event-type="combat.entity_defeated" data-simulation-tick="520" data-state-version="7" data-entity-id="enemy.normal.002" data-cause-event-id="gm06.damage.001" aria-label="敵撃破"><i></i><i></i><i></i><i></i></span>
      <span class="reward-provisional shape-provisional" data-causality="reward-provisional" data-binding="reward.feedback" data-semantic-shape="open-edge" data-event-id="gm06.reward.001" data-event-type="reward.provisional" data-simulation-tick="680" data-state-version="8" data-reward-event-id="gm06.reward.001" data-settlement-id="gm06.settlement.001" data-reward-status="provisional" data-reward-status-version="1" data-currency-canonical-id="coin.run" data-amount-decimal="9" data-source-entity-id="enemy.normal.002" data-defeat-event-id="gm06.defeat.001">${icon('coin')}<strong>見込み +9 G</strong></span>`;
  }

  function renderBattle(spec) {
    const objectiveCurrent = spec.state === 'reward' ? 60 : 57;
    const objectiveRequired = 60;
    const counter = `${objectiveCurrent} / ${objectiveRequired}`;
    const objective = `階層制圧 ${counter}`;
    return `
      <section class="battle-region" data-testid="battlefield" aria-label="26階の通常戦闘">
        <div class="tower-scene" data-layer-kind="background" data-asset-path="assets/tower-corridor.webp" data-frame-id="background.tower-corridor.full" aria-hidden="true"></div>
        <div class="scene-light" aria-hidden="true"></div>
        <div class="battle-head">
          <div class="floor-marker" data-area-display="無限塔・月影回廊" aria-label="無限塔・月影回廊 26階">${icon('tower')}<span><small>無限塔</small><strong data-binding="tower.floor" data-floor-decimal="26">26階</strong></span></div>
          <div class="battle-objective"><small>現在の目標</small><strong data-binding="encounter.objective" data-objective-current="${objectiveCurrent}" data-objective-required="${objectiveRequired}">${objective}</strong></div>
          <div class="auto-chip" data-binding="battle.autoState" data-auto-status="RUNNING" role="status" aria-label="AUTO 稼働中">${icon('auto')}<span>AUTO</span><b>稼働中</b></div>
        </div>
        ${renderThreat(spec)}
        <div class="battlefield-body">
          <span class="engagement-line" aria-hidden="true"></span>
          ${renderCats(spec)}
          ${renderEnemy(spec)}
          ${renderRewardEffects(spec)}
        </div>
        ${renderCombatEvent(spec)}
        <div class="floor-progress" data-objective-current="${objectiveCurrent}" data-objective-required="${objectiveRequired}" role="progressbar" aria-label="${objective}" aria-valuemin="0" aria-valuenow="${objectiveCurrent}" aria-valuemax="${objectiveRequired}" aria-valuetext="${objective}">
          <span>${icon('target')}階層制圧</span><i><b style="width:${spec.state === 'reward' ? 100 : 95}%"></b></i><strong>${counter}</strong>
        </div>
      </section>`;
  }

  function renderCombatEvent(spec) {
    const message = spec.state === 'reward'
      ? `${icon('sword')}<span><strong>ルナの射撃</strong><small>命中 · 撃破 · 報酬見込み +9 G</small></span>`
      : spec.state === 'offline'
        ? `${icon('clock')}<span><strong>前回記録</strong><small>照合中</small></span>`
        : spec.state === 'roster'
          ? `${icon('party')}<span><strong>出撃はムギのみ</strong><small>4枠の状態を確認</small></span>`
          : `${icon('shield')}<span><strong>AUTO交戦中</strong><small>4体が敵を捕捉 · 次の攻撃を待機</small></span>`;
    return `<div class="combat-event" aria-label="現在の戦闘因果">${message}</div>`;
  }

  function renderSupport() {
    return `
      <section class="support-row" aria-label="編成後の商会支援">
        <div class="support-strip" data-support-state="SCHEDULED" data-support-id="support.guild.delivery" data-application-scope="NEXT_ENCOUNTER" data-target-encounter-id="fixture.s02.floor26.next.001" data-binding="support.shopDelivery" aria-label="商会配送、次戦支援に適用予定">
          ${icon('wagon')}<span class="support-copy"><strong>次戦支援</strong><small>商会配送 · 適用予定</small></span>
        </div>
      </section>`;
  }

  function rosterStates(spec) {
    if (spec.state !== 'roster') return cats.map(() => ({ key: 'field', label: '戦場参加中', icon: 'field', shape: 'raised-pennant-double-brass' }));
    return [
      { key: 'field', label: '戦場参加中', icon: 'field', shape: 'raised-pennant-double-brass' },
      { key: 'owned', label: '所有済み', icon: 'chest', shape: 'flat-tab-single-iron' },
      { key: 'available', label: '加入可能', icon: 'door', shape: 'ticket-notch-dashed-brass' },
      { key: 'locked', label: '未解放', icon: 'lock', shape: 'diagonal-corner-solid-iron' }
    ];
  }

  function renderParty(spec) {
    const states = rosterStates(spec);
    const count = spec.state === 'roster' ? 1 : 4;
    return `
      <section class="party-dock" data-testid="party-dock" aria-label="常設4枠編成">
        <div class="party-heading">${icon('party')}<strong>編成 ${count} / 4 出撃</strong><small>${spec.state === 'roster' ? '文言と形で状態を区別' : '常設4枠'}</small></div>
        <div class="party-grid">
          ${cats.map((cat, index) => {
            const status = states[index];
            return `
              <article class="party-card state-${status.key}" data-party-id="${cat.id}" data-slot-index="${index}" data-party-state="${status.key}" data-semantic-shape="${status.shape}" data-battlefield="${status.key === 'field'}" data-binding="party.slotIdentity" aria-label="${cat.name}、${status.label}、${cat.role}">
                <span class="party-portrait" style="--frame-x:${cat.position}" aria-hidden="true"><i></i></span>
                <span class="party-name"><strong>${cat.name}</strong><small>${cat.role}</small></span>
                <span class="party-state" data-binding="party.slotState">${icon(status.icon)}<b>${status.label}</b></span>
              </article>`;
          }).join('')}
        </div>
      </section>`;
  }

  function renderPrimaryAction(spec) {
    const label = '編成を整える';
    return `
      <div class="primary-action-wrap">
        <button type="button" class="primary-action" data-control-priority="primary" data-binding="navigation.primary" data-screen-id="S06" data-review-interaction="visual-only" aria-label="${label}">
          ${icon('party')}<span><small>次にできること</small><strong data-label data-primary-label>${label}</strong></span>${icon('arrow')}
        </button>
      </div>`;
  }

  function renderNav() {
    const nav = [
      { iconName: 'sword', label: '戦闘', screenId: 'S02', current: true },
      { iconName: 'party', label: '編成', screenId: 'S06', current: false },
      { iconName: 'bag', label: '商会', screenId: 'S05', current: false },
      { iconName: 'chart', label: '塔記録', screenId: 'S03', current: false },
      { iconName: 'menu', label: 'その他', screenId: '', current: false }
    ];
    return `
      <nav class="bottom-nav" data-testid="bottom-nav" aria-label="主要ナビゲーション">
        ${nav.map(({ iconName, label, screenId, current }) => {
          const disabled = label === 'その他';
          return `<button type="button" class="nav-button${current ? ' is-current' : ''}" data-binding="navigation.bottom"${screenId ? ` data-screen-id="${screenId}"` : ''} data-review-interaction="visual-only" aria-label="${disabled ? `${label}、利用不可` : label}"${current ? ' aria-current="page"' : ''}${disabled ? ' disabled aria-disabled="true"' : ''}>${icon(iconName)}<span>${label}</span></button>`;
        }).join('')}
      </nav>`;
  }

  function renderOfflineProgress(view) {
    if (view.progress === 'none') return '';
    if (view.progress === 'determinate') {
      return `<div class="offline-progress is-determinate" data-binding="offline.progress" data-progress-kind="determinate" data-progress-ratio-decimal="${view.progressValue / 100}" data-fixture-claim-only="true" data-not-runtime-authority="true" role="progressbar" aria-label="照合進行 ${view.progressValue}%" aria-valuemin="0" aria-valuenow="${view.progressValue}" aria-valuemax="100"><i style="width:${view.progressValue}%"></i></div>`;
    }
    return '<div class="offline-progress" data-binding="offline.progress" data-progress-kind="indeterminate" role="progressbar" aria-label="照合中、進行率は未確定"><i></i></div>';
  }

  function renderOfflineRows(view) {
    if (!view.rows.length) return '';
    return `<dl data-binding="offline.outcome">${view.rows.map(([term, value]) => `<div><dt>${term}</dt><dd${term === '獲得コイン' ? ' data-currency-canonical-id="coin.run" data-amount-decimal="1840"' : ''}>${value}</dd></div>`).join('')}</dl>`;
  }

  function renderOfflineActions(view) {
    const actions = [];
    const hasStateAction = view.actions.includes('retry') || view.actions.includes('continue');
    if (view.actions.includes('retry')) {
      actions.push('<button type="button" data-control-priority="primary" data-review-state-action="retry">再確認する</button>');
    }
    if (view.actions.includes('continue')) {
      actions.push('<button type="button" data-control-priority="primary" data-review-state-action="continue">塔へ戻る</button>');
    }
    actions.push(`<button type="button" data-control-priority="${hasStateAction ? 'secondary' : 'primary'}" data-review-action="dismiss-offline">閉じる</button>`);
    return `<div class="offline-actions">${actions.join('')}</div>`;
  }

  function renderOffline(spec, offlineState) {
    if (spec.state !== 'offline') return '';
    const view = offlineViewStates[offlineState];
    const semanticShape = {
      NO_PROGRESS: ['shape-none', 'flat-edge'],
      ELAPSED_UNKNOWN: ['shape-unknown', 'dotted-edge'],
      RECONCILING_INDETERMINATE: ['shape-confirming', 'hourglass-notch'],
      RECONCILING_DETERMINATE: ['shape-confirming', 'hourglass-notch'],
      PROVISIONAL: ['shape-provisional', 'open-edge'],
      CONFIRMING: ['shape-confirming', 'hourglass-notch'],
      CONFIRMED: ['shape-confirmed', 'closed-brass-seal'],
      REJECTED: ['shape-rejected', 'barred-edge'],
      RETRYABLE_ERROR: ['shape-retryable', 'broken-loop-edge'],
      UNKNOWN: ['shape-unknown', 'dotted-edge']
    }[offlineState];
    const elapsedAttribute = view.elapsedSeconds === null ? '' : ` data-elapsed-seconds="${view.elapsedSeconds}"`;
    const retryAttribute = view.retryCapability ? ' data-retry-capability="true"' : ' data-retry-capability="false"';
    return `
      <div class="offline-layer" data-offline-reconciliation="${offlineState}" data-offline-view-state="${offlineState}" data-settlement-id="gm07.settlement.001" data-status-version="1"${retryAttribute}>
        <section class="offline-modal" role="dialog" aria-modal="true" aria-labelledby="offline-title" aria-describedby="offline-description">
          <header class="offline-modal-head">
            <div class="offline-seal">${icon('clock')}</div>
            <p>OFFLINE RECONCILIATION</p>
            <h2 id="offline-title">放置結果の確認</h2>
            <strong class="offline-state-label ${semanticShape[0]}" data-offline-state-label="${offlineState}" data-semantic-shape="${semanticShape[1]}">${view.label}</strong>
          </header>
          <div class="offline-modal-body" role="region" aria-label="放置結果の詳細" tabindex="0">
            <p id="offline-description" data-binding="offline.elapsed"${elapsedAttribute} data-cap-seconds="43200" data-cap-display="上限12時間">${view.description}</p>
            ${renderOfflineRows(view)}
            ${renderOfflineProgress(view)}
            <strong class="offline-note" data-binding="settlement.status">${view.note}</strong>
          </div>
          <footer class="offline-modal-footer">
            ${renderOfflineActions(view)}
            <span class="offline-review-notice" role="status" aria-live="polite"></span>
          </footer>
        </section>
      </div>`;
  }

  function renderStage(id, spec, offlineState) {
    const stage = document.createElement('article');
    stage.className = `gm-stage state-${spec.state}`;
    stage.dataset.testid = 'gm-stage';
    stage.dataset.gm = id;
    stage.dataset.fixtureId = `s02.p1.fixture.${id}`;
    stage.dataset.synthetic = 'true';
    stage.dataset.notRuntime = 'true';
    stage.setAttribute('aria-label', `${id} ${spec.title}`);
    stage.innerHTML = `
      <div class="game-ui" data-testid="game-ui" data-binding="screen.uiState" data-screen-ui-state="${spec.state === 'offline' ? 'RECONCILE' : 'READY'}"${spec.state === 'offline' ? ' inert aria-hidden="true"' : ''}>
        ${renderHud()}
        ${renderBattle(spec)}
        ${renderPrimaryAction(spec)}
        ${renderParty(spec)}
        ${renderSupport()}
        ${renderNav()}
      </div>
      ${renderOffline(spec, offlineState)}`;
    return stage;
  }

  const query = new URLSearchParams(window.location.search);
  const requested = String(query.get('gm') || 'GM01').toUpperCase();
  const id = Object.hasOwn(gmSpecs, requested) ? requested : 'GM01';
  const spec = gmSpecs[id];
  const requestedOfflineState = String(query.get('offline') || 'CONFIRMING').toUpperCase();
  const offlineState = Object.hasOwn(offlineViewStates, requestedOfflineState) ? requestedOfflineState : 'CONFIRMING';
  const root = document.getElementById('review-stage');
  const stage = renderStage(id, spec, offlineState);
  root.replaceChildren(stage);

  const nominalSizes = {
    GM01: [390, 844], GM02: [320, 667], GM03: [375, 667], GM04: [320, 568],
    GM05: [430, 932], GM06: [390, 844], GM07: [390, 844], GM08: [390, 844]
  };
  const responsiveEvidenceSizes = {
    '320x568': [320, 568],
    '320x667': [320, 667],
    '375x667': [375, 667],
    '360x800': [360, 800],
    '390x844': [390, 844],
    '412x915': [412, 915],
    '430x932': [430, 932]
  };
  const requestedResponsiveViewport = String(query.get('rv') || '');
  const responsiveEvidenceViewport = Object.hasOwn(responsiveEvidenceSizes, requestedResponsiveViewport)
    ? responsiveEvidenceSizes[requestedResponsiveViewport]
    : null;
  const reviewSurface = document.getElementById('review-surface');
  const reviewStageFrame = document.getElementById('review-stage-frame');
  const referenceCompare = document.getElementById('reference-compare');
  const [nominalWidth, nominalHeight] = responsiveEvidenceViewport || nominalSizes[id];
  reviewSurface.style.setProperty('--nominal-width', `${nominalWidth}px`);
  reviewSurface.style.setProperty('--nominal-height', `${nominalHeight}px`);
  stage.dataset.layoutViewport = `${nominalWidth}x${nominalHeight}`;
  stage.dataset.responsiveEvidenceOverride = responsiveEvidenceViewport ? requestedResponsiveViewport : '';

  document.querySelectorAll('[data-review-gm]').forEach((link) => {
    const selected = link.dataset.reviewGm === id;
    const target = new URL(window.location.href);
    target.searchParams.set('gm', link.dataset.reviewGm);
    target.searchParams.delete('offline');
    target.searchParams.delete('rv');
    target.hash = '';
    link.href = `${target.pathname}${target.search}`;
    link.classList.toggle('is-selected', selected);
    if (selected) link.setAttribute('aria-current', 'page');
  });
  document.getElementById('review-id').textContent = id;
  document.getElementById('review-title').textContent = spec.title;
  document.title = `${id} — S02 Golden Master — Design Review`;

  const offlineStateSwitch = document.getElementById('offline-state-switch');
  const offlineStateSelect = document.getElementById('offline-state-select');
  if (id === 'GM07') {
    offlineStateSwitch.hidden = false;
    offlineStateSelect.value = offlineState;
    offlineStateSelect.addEventListener('change', () => {
      const target = new URL(window.location.href);
      target.searchParams.set('gm', 'GM07');
      target.searchParams.set('offline', offlineStateSelect.value);
      target.hash = '';
      window.location.assign(`${target.pathname}${target.search}`);
    });
  }

  let actualSizeEnabled = false;

  function syncReviewScale() {
    const availableWidth = Math.max(280, Math.min(window.innerWidth, reviewSurface.clientWidth || window.innerWidth));
    const scale = actualSizeEnabled ? 1 : Math.min(1, availableWidth / nominalWidth);
    root.style.setProperty('--review-scale', String(scale));
    root.classList.toggle('is-fit-scaled', scale < 0.999999);
    reviewStageFrame.style.width = `${nominalWidth * scale}px`;
    reviewStageFrame.style.height = `${nominalHeight * scale}px`;
    reviewSurface.dataset.reviewScale = scale.toFixed(6);
    reviewSurface.dataset.reviewSizing = actualSizeEnabled ? 'ACTUAL_1_TO_1' : 'FIT_WIDTH';
    document.getElementById('viewport-readout').textContent = `設計 ${nominalWidth} × ${nominalHeight} CSS px · ${Math.round(scale * 100)}%表示 · browser ${window.innerWidth} × ${window.innerHeight}`;
  }

  function setActualSize(enabled) {
    actualSizeEnabled = enabled;
    reviewSurface.classList.toggle('is-actual-size', enabled);
    document.getElementById('fit-view').setAttribute('aria-pressed', String(!enabled));
    document.getElementById('actual-button').setAttribute('aria-pressed', String(enabled));
    syncReviewScale();
  }

  function setComparison(enabled) {
    reviewSurface.classList.toggle('is-comparing', enabled);
    referenceCompare.hidden = !enabled;
    document.getElementById('single-view').setAttribute('aria-pressed', String(!enabled));
    document.getElementById('compare-button').setAttribute('aria-pressed', String(enabled));
  }

  document.getElementById('fit-view').addEventListener('click', () => setActualSize(false));
  document.getElementById('actual-button').addEventListener('click', () => setActualSize(true));
  document.getElementById('single-view').addEventListener('click', () => setComparison(false));
  document.getElementById('compare-button').addEventListener('click', () => setComparison(true));
  const offlineClose = document.querySelector('[data-review-action="dismiss-offline"]');
  offlineClose?.addEventListener('click', (event) => {
    event.currentTarget.closest('.offline-layer')?.setAttribute('hidden', '');
    const gameUi = stage.querySelector('.game-ui');
    gameUi?.removeAttribute('inert');
    gameUi?.removeAttribute('aria-hidden');
    if (gameUi) gameUi.dataset.screenUiState = 'READY';
    stage.dataset.offlineOverlayDismissed = 'true';
    gameUi?.querySelector('.primary-action')?.focus({ preventScroll: true });
  });
  offlineClose?.focus({ preventScroll: true });
  document.querySelectorAll('[data-review-state-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const notice = stage.querySelector('.offline-review-notice');
      if (notice) notice.textContent = 'デザインレビューのため通信や保存は行いません。';
    });
  });

  function syncEnvironment() {
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    stage.classList.toggle('text-scale-200', rootSize >= 28);
    syncReviewScale();
  }

  const rootStyleObserver = new MutationObserver(syncEnvironment);
  rootStyleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  const layoutObserver = new ResizeObserver(syncEnvironment);
  layoutObserver.observe(reviewSurface);
  window.addEventListener('resize', syncEnvironment, { passive: true });
  syncEnvironment();
  requestAnimationFrame(() => {
    syncEnvironment();
    document.body.dataset.reviewReady = 'true';
  });
})();
