(() => {
  'use strict';

  const ROOT_SOURCE = '/step4/s02/index.html';
  const APP_SOURCE = '/step4/s02/app.js';
  const LEGACY_SOURCE = '/legacy.html';
  const mount = document.getElementById('game-root');

  function renderFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = document.createElement('main');
    fallback.className = 'main-entry-failure';
    fallback.setAttribute('role', 'alert');
    fallback.innerHTML = `
      <h1>ゲーム画面を読み込めませんでした</h1>
      <p>通信状態を確認して再読み込みしてください。</p>
      <p class="main-entry-error"></p>
      <div class="main-entry-actions">
        <button type="button" id="main-entry-retry">再読み込み</button>
        <a href="${LEGACY_SOURCE}">旧ビルドを開く</a>
      </div>
    `;
    fallback.querySelector('.main-entry-error').textContent = message;
    fallback.querySelector('#main-entry-retry').addEventListener('click', () => window.location.reload());
    mount?.replaceWith(fallback);
    document.documentElement.dataset.mainEntryReady = 'failed';
  }

  function loadClassicScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.defer = true;
      script.dataset.mainEntryScript = 's02';
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${source}`)), { once: true });
      document.body.append(script);
    });
  }

  async function mountS02() {
    if (!mount) throw new Error('Main-entry mount point is missing.');

    const response = await fetch(ROOT_SOURCE, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/html' }
    });
    if (!response.ok) throw new Error(`S02 source returned HTTP ${response.status}.`);

    const sourceText = await response.text();
    const sourceDocument = new DOMParser().parseFromString(sourceText, 'text/html');
    const sourceShell = sourceDocument.querySelector('[data-testid="s02-shell"]');
    if (!sourceShell) throw new Error('S02 source shell was not found.');

    const shell = document.importNode(sourceShell, true);
    shell.dataset.runtimeEntry = 'main';
    shell.dataset.sourceRoute = ROOT_SOURCE;
    mount.replaceWith(shell);

    await loadClassicScript(APP_SOURCE);
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        if (shell.dataset.ready === 'true') {
          resolve();
          return;
        }
        if (performance.now() - started > 6000) {
          reject(new Error('S02 application did not signal readiness.'));
          return;
        }
        window.requestAnimationFrame(poll);
      };
      poll();
    });

    document.documentElement.dataset.mainEntryReady = 'true';
    window.dispatchEvent(new CustomEvent('cats-tower:main-entry-ready', {
      detail: { screen: 'S02', source: ROOT_SOURCE }
    }));
  }

  window.__CATS_TOWER_MAIN_ENTRY__ = Object.freeze({
    screen: 'S02',
    source: ROOT_SOURCE,
    legacy: LEGACY_SOURCE,
    production: false,
    physicalIPhoneVerified: false
  });

  mountS02().catch(renderFailure);
})();
