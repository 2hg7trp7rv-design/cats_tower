(() => {
  'use strict';

  const root = document.querySelector('[data-testid="s02-shell"]');
  if (!root) return;

  const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const toast = document.getElementById('toast');
  const srStatus = document.getElementById('sr-status');
  const battleStatus = document.getElementById('battle-status');
  const autoToggle = document.getElementById('auto-toggle');
  const speedToggle = document.getElementById('speed-toggle');
  const supportButton = document.getElementById('support-button');
  const supportState = document.getElementById('support-state');
  const supportTimer = document.getElementById('support-timer');
  const bossHp = document.getElementById('boss-hp');
  const battleFlash = document.querySelector('.battle-flash');
  const criticalDamage = document.querySelector('.damage-critical');

  const state = {
    auto: true,
    speedIndex: 1,
    speeds: [1, 1.5, 2],
    supportRemaining: 0,
    supportDuration: 58,
    supportInterval: null,
    autoInterval: null,
    autoHitIndex: 0,
    bossHpPercent: 34,
    cooldownIntervals: new Map(),
    toastTimer: null,
  };

  function announce(message) {
    if (srStatus) srStatus.textContent = message;
  }

  function showToast(message, duration = 1600) {
    if (!toast) return;
    window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, duration);
    announce(message);
  }

  function pressFeedback(button) {
    button.classList.add('is-pressed');
    window.setTimeout(() => button.classList.remove('is-pressed'), 120);
  }

  function setAuto(nextValue, { announceChange = true } = {}) {
    state.auto = Boolean(nextValue);
    autoToggle.classList.toggle('is-active', state.auto);
    autoToggle.setAttribute('aria-pressed', String(state.auto));
    autoToggle.setAttribute('aria-label', `オート戦闘 ${state.auto ? 'オン' : 'オフ'}`);
    autoToggle.querySelector('strong').textContent = state.auto ? 'ON' : 'OFF';
    battleStatus.textContent = state.auto ? '自動戦闘中…' : '手動戦闘中';
    document.querySelector('.status-dot').style.background = state.auto ? '#8fd64e' : '#e66047';
    if (announceChange) showToast(`オート戦闘を${state.auto ? 'ON' : 'OFF'}にしました`);
    scheduleAutoHits();
  }

  function setSpeed(index, { announceChange = true } = {}) {
    state.speedIndex = (index + state.speeds.length) % state.speeds.length;
    const speed = state.speeds[state.speedIndex];
    speedToggle.querySelector('strong').textContent = `×${speed}`;
    speedToggle.setAttribute('aria-label', `戦闘速度 ${speed}倍`);
    if (announceChange) showToast(`戦闘速度を${speed}倍に変更しました`);
    scheduleAutoHits();
  }

  function animateDamage(amount, critical = false) {
    const target = criticalDamage;
    if (!target) return;
    target.textContent = Number(amount).toLocaleString('ja-JP');
    target.classList.remove('is-hit');
    void target.offsetWidth;
    target.classList.add('is-hit');

    if (!reduceMotionQuery.matches && battleFlash) {
      battleFlash.classList.remove('is-active');
      void battleFlash.offsetWidth;
      battleFlash.classList.add('is-active');
    }

    if (critical) {
      const label = document.querySelector('.critical-label');
      if (label) label.textContent = 'CRITICAL!';
    }
  }

  function damageBoss(amount = 2) {
    state.bossHpPercent = Math.max(8, state.bossHpPercent - amount);
    if (bossHp) bossHp.style.width = `${state.bossHpPercent}%`;
    if (state.bossHpPercent <= 8) {
      window.setTimeout(() => {
        state.bossHpPercent = 34;
        if (bossHp) bossHp.style.width = '34%';
      }, 850);
    }
  }

  function scheduleAutoHits() {
    window.clearInterval(state.autoInterval);
    state.autoInterval = null;
    if (!state.auto || reduceMotionQuery.matches) return;

    const speed = state.speeds[state.speedIndex];
    const interval = Math.max(780, Math.round(1650 / speed));
    state.autoInterval = window.setInterval(() => {
      state.autoHitIndex += 1;
      const critical = state.autoHitIndex % 4 === 0;
      const amount = critical ? 2458 + state.autoHitIndex * 11 : 284 + (state.autoHitIndex % 5) * 37;
      animateDamage(amount, critical);
      damageBoss(critical ? 4 : 2);
    }, interval);
  }

  function activateSkill(button) {
    if (button.classList.contains('is-cooling')) {
      showToast(`${button.dataset.skill}は再使用待ちです`);
      return;
    }

    const skillName = button.dataset.skill || 'スキル';
    const duration = Number(button.dataset.cooldown || 6);
    const cooldownLabel = button.querySelector('.cooldown-mask em');
    let remaining = duration;

    button.classList.add('is-cooling');
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-label', `${skillName} 再使用まで${remaining}秒`);
    if (cooldownLabel) cooldownLabel.textContent = String(remaining);

    const isUltimate = button.classList.contains('ultimate');
    const isHeal = skillName.includes('癒し');
    const isSupport = skillName.includes('満腹');

    if (isHeal) {
      showToast(`${skillName}：仲間のHPを回復しました`);
    } else if (isSupport) {
      showToast(`${skillName}：攻撃速度が上昇しました`);
    } else {
      const amount = isUltimate ? 16840 : 2458 + Math.floor(Math.random() * 1200);
      animateDamage(amount, isUltimate);
      damageBoss(isUltimate ? 9 : 4);
      showToast(`${skillName}を発動しました`);
    }

    const interval = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(interval);
        state.cooldownIntervals.delete(button);
        button.classList.remove('is-cooling');
        button.removeAttribute('aria-disabled');
        button.setAttribute('aria-label', `${skillName} 使用可能`);
        if (cooldownLabel) cooldownLabel.textContent = '';
        announce(`${skillName}が再使用可能になりました`);
        return;
      }
      if (cooldownLabel) cooldownLabel.textContent = String(remaining);
      button.setAttribute('aria-label', `${skillName} 再使用まで${remaining}秒`);
    }, 1000);

    state.cooldownIntervals.set(button, interval);
  }

  function formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }

  function renderSupportState() {
    if (state.supportRemaining > 0) {
      supportButton.classList.add('is-active');
      supportButton.classList.remove('is-cooling');
      supportButton.setAttribute('aria-pressed', 'true');
      supportButton.setAttribute('aria-label', `商会支援 発動中 残り${state.supportRemaining}秒`);
      supportState.textContent = '発動中';
      supportTimer.textContent = formatTimer(state.supportRemaining);
      supportTimer.setAttribute('datetime', `PT${state.supportRemaining}S`);
    } else {
      supportButton.classList.remove('is-active', 'is-cooling');
      supportButton.setAttribute('aria-pressed', 'false');
      supportButton.setAttribute('aria-label', '商会支援を発動する');
      supportState.textContent = '発動可能';
      supportTimer.textContent = formatTimer(state.supportDuration);
      supportTimer.setAttribute('datetime', `PT${state.supportDuration}S`);
    }
  }

  function activateSupport() {
    if (state.supportRemaining > 0) {
      showToast(`商会支援は発動中です（残り${formatTimer(state.supportRemaining)}）`);
      return;
    }

    state.supportRemaining = state.supportDuration;
    renderSupportState();
    showToast('商会支援を発動しました：攻撃力・回復・会心率UP');

    window.clearInterval(state.supportInterval);
    state.supportInterval = window.setInterval(() => {
      state.supportRemaining -= 1;
      if (state.supportRemaining <= 0) {
        window.clearInterval(state.supportInterval);
        state.supportInterval = null;
        state.supportRemaining = 0;
        renderSupportState();
        announce('商会支援が終了し、再び発動可能になりました');
        return;
      }
      renderSupportState();
    }, 1000);
  }

  function handleGenericAction(button) {
    const action = button.dataset.action;
    const labels = {
      profile: '冒険者プロフィールはS06仲間画面で開きます',
      coin: 'コイン内訳を確認しました',
      ruby: 'ルビー台帳はS11で確認します',
      reputation: '評判は町と商会の解放に使用します',
      menu: 'メニューを開きました',
      target: '26Fの敵情報を確認しました',
      event: 'グルメ祭りの詳細を開きました',
      mission: 'ミッションを開きました',
      present: 'プレゼントが1件あります',
      daily: 'デイリー報酬を確認しました',
      friend: 'フレンド画面を開きました',
      guild: 'ギルド支援を確認しました',
      formation: '編成画面はS06で開きます',
      sortie: '現在4体で出撃中です',
      enhance: '強化候補が2件あります',
      shop: '商店画面はS05で開きます',
      'battle-mission': '戦闘ミッションを確認しました',
      'support-help': '商会支援は店舗の成長に応じて効果が上昇します',
      'member-mike': '剣士ミケを選択しました',
      'member-luna': '賢者ルナを選択しました',
      'member-robin': '狩人ロビンを選択しました',
      'member-pom': '料理人ポムを選択しました',
      'member-nico': '魔導士ニコを選択しました',
    };

    if (action === 'menu') {
      button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    }

    if (action?.startsWith('member-')) {
      document.querySelectorAll('.roster-card:not(.locked)').forEach((card) => card.classList.remove('active'));
      button.classList.add('active');
    }

    showToast(labels[action] || '準備中の機能です');
  }

  autoToggle.addEventListener('click', () => setAuto(!state.auto));
  speedToggle.addEventListener('click', () => setSpeed(state.speedIndex + 1));
  supportButton.addEventListener('click', activateSupport);

  document.querySelectorAll('.skill-button').forEach((button) => {
    button.addEventListener('click', () => activateSkill(button));
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      pressFeedback(button);
      handleGenericAction(button);
    });
  });

  document.querySelectorAll('.nav-button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-button').forEach((item) => {
        item.classList.remove('is-active');
        item.removeAttribute('aria-current');
      });
      button.classList.add('is-active');
      button.setAttribute('aria-current', 'page');
      showToast(`${button.querySelector('strong').textContent}タブを選択しました`);
    });
  });

  const eventBanner = document.querySelector('.event-banner');
  eventBanner?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      eventBanner.click();
    }
  });

  reduceMotionQuery.addEventListener?.('change', () => {
    scheduleAutoHits();
    announce(reduceMotionQuery.matches ? '動きを減らす設定を反映しました' : '通常の動きを反映しました');
  });

  window.addEventListener('pagehide', () => {
    window.clearInterval(state.autoInterval);
    window.clearInterval(state.supportInterval);
    state.cooldownIntervals.forEach((interval) => window.clearInterval(interval));
  });

  renderSupportState();
  setAuto(true, { announceChange: false });
  setSpeed(1, { announceChange: false });
  root.dataset.ready = 'true';
})();
