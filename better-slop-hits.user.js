// ==UserScript==
// @name         Better SlopHits
// @namespace    BetterSlopHits
// @version      2026-11-02.03
// @description  A larger SlopHits player and confirmed likes on X.
// @match        https://slophits.com/*
// @match        https://x.com/*/status/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @noframes
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  const requestPrefix = 'bsh-like:';
  const requestLifetime = 60000;

  async function runXBridge() {
    // X canonicalizes /i/status URLs and drops the hash. Keep the request
    // identity in this helper tab only so confirmation survives a reload.
    const nonce = new URLSearchParams(location.hash.slice(1)).get('bsh-like') || sessionStorage.getItem('bsh-active-like');
    if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce)) return;
    const key = requestPrefix + nonce;
    const request = GM_getValue(key);
    const postId = location.pathname.match(/\/status\/(\d+)\/?$/)?.[1];
    if (!request || request.id !== postId || request.phase !== 'requested' || request.expiresAt < Date.now()) return;
    sessionStorage.setItem('bsh-active-like', nonce);
    const attemptKey = requestPrefix + nonce;
    const attempted = sessionStorage.getItem(attemptKey) === 'verify';
    const stillRequested = () => {
      const current = GM_getValue(key);
      return current?.phase === 'requested' && current.expiresAt > Date.now();
    };
    const finish = (ok, message) => {
      if (stillRequested()) GM_setValue(key, { ...request, phase: 'done', ok, message });
      sessionStorage.removeItem(attemptKey);
      sessionStorage.removeItem('bsh-active-like');
    };
    const findArticle = () => [...document.querySelectorAll('article')].find(article => {
      // Quoted posts may have an earlier <time> without a permalink.
      return [...article.querySelectorAll('time')].some(time => {
        const permalink = time.closest('a')?.getAttribute('href');
        return permalink?.split('?')[0].endsWith('/status/' + postId);
      });
    });
    const until = async predicate => {
      const deadline = Math.min(Date.now() + 20000, request.expiresAt);
      let loginSince = 0;
      while (Date.now() < deadline && stillRequested()) {
        const value = predicate();
        if (value) return value;
        const loggedOut = location.pathname.startsWith('/i/flow/login') || (document.querySelector('[data-testid="loginButton"]') && !document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'));
        loginSince = loggedOut ? (loginSince || Date.now()) : 0;
        if (loginSince && Date.now() - loginSince >= 3000) {
          throw new Error('Sign in to X, then try liking this track again.');
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Could not confirm the like. It may have succeeded; check X or retry safely.');
    };
    try {
      const article = await until(() => {
        const found = findArticle();
        return found?.querySelector('[data-testid="like"], [data-testid="unlike"]') && found;
      });
      if (article.querySelector('[data-testid="unlike"]')) {
        finish(true, attempted ? 'Liked on X' : 'Already liked on X');
        return;
      }
      if (attempted) {
        // Hydration can briefly render a stale Like button after a reload.
        // Wait for the saved state without ever clicking a second time.
        await until(() => findArticle()?.querySelector('[data-testid="unlike"]'));
        finish(true, 'Liked on X');
        return;
      }
      if (!stillRequested()) return;
      // Click only Like, never Unlike. A fresh page must confirm persistence:
      // X's immediate optimistic button change is not a success receipt.
      sessionStorage.setItem(attemptKey, 'verify');
      article.querySelector('[data-testid="like"]').click();
      await until(() => findArticle()?.querySelector('[data-testid="unlike"]'));
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (stillRequested()) location.reload();
    } catch (error) {
      finish(false, error.message);
    }
  }

  if (location.hostname === 'x.com') {
    runXBridge();
    return;
  }
  // Capture the X request hash before its router runs, but wait for SlopHits'
  // document before adding UI and observing the body.
  function startSlopHits() {
  if (document.getElementById('bsh-player-style')) return;

  const style = document.createElement('style');
  style.id = 'bsh-player-style';
  style.textContent = `
    .bsh-like { background: var(--yellow, #ffe600); color: var(--black, #111); }
    .bsh-like:disabled { opacity: .55; cursor: wait; }
    .picks:has(> .bsh-like) { grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr) 64px; gap: 12px; }
    .picks > .bsh-like { min-width: 0; min-height: 48px; box-shadow: 5px 5px 0 #000; }
    .picks > .bsh-like > span { display: block; }
    .rc:has(> .bsh-like) { grid-template-columns: minmax(0, 1.5fr) repeat(6, minmax(0, 1fr)); }
    .bsh-toast {
      position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%);
      z-index: 2000; max-width: calc(100vw - 32px); box-sizing: border-box;
      padding: 12px 18px; background: var(--yellow, #ffe600); color: var(--black, #111);
      font-size: 14px; line-height: 1.4; font-family: inherit; font-weight: 700;
      border: 2px solid var(--black, #111); box-shadow: 4px 4px 0 #000;
      pointer-events: none; text-align: center;
    }
    .bsh-toast[data-error="true"] { background: var(--red, #ff2d1f); color: white; }
    html.bsh-player-open { overflow: hidden !important; }
    .dock.bsh-player:not(.fs) {
      inset: 0; z-index: 1000; padding: 16px;
      display: grid; place-items: center; box-sizing: border-box;
      background: rgb(0 0 0 / 80%); box-shadow: none;
      transform: none; transition: none;
    }
    .dock.bsh-player:not(.up) { display: none; }
    .dock.bsh-player:not(.fs) .dk-in {
      width: min(100%, 808px); max-width: none; max-height: 100%;
      box-sizing: border-box; overflow: auto; overscroll-behavior: contain;
      margin: 0; padding: 16px; background: var(--black, #111);
      border-top: 4px solid var(--yellow, #ffed00);
      box-shadow: 0 16px 64px #0009;
      grid-template-columns: minmax(0, 1fr) auto 40px;
      grid-template-areas: 'scr scr scr' 'info keys x' 'seek seek seek';
      gap: 12px;
    }
    .dock.bsh-player:not(.fs) .dk-scr {
      width: 100%; max-height: 65dvh; aspect-ratio: 16 / 9;
      justify-self: center; background: #000;
    }
    .dock.bsh-player:not(.fs) .dk-scr > video,
    .dock.bsh-player:not(.fs) .dk-scr > img { object-fit: contain; }
    .dock.bsh-player .dk-scr .fsk,
    .dock.bsh-player .dk-scr .snd { width: 44px; height: 44px; }
    .dock.bsh-player .dk-scr .fsk svg,
    .dock.bsh-player .dk-scr .snd svg { height: 14px; }
    .dock.bsh-player .dk-keys .rc-k { min-width: 48px; min-height: 48px; }
    .dock.bsh-player .dk-keys .rc-k > span { display: block; }
    .dock.bsh-player .dk-x { min-height: 44px; }
    @media (max-width: 600px) {
      .rc:has(> .bsh-like) { grid-template-columns: repeat(6, minmax(0, 1fr)); }
      .rc:has(> .bsh-like) > .rc-led {
        grid-column: 1 / -1; flex-direction: row; align-items: center; justify-content: space-between;
      }
      .dock.bsh-player:not(.fs) { padding: 8px; }
      .dock.bsh-player:not(.fs) .dk-in {
        padding: 10px; gap: 10px; grid-template-columns: minmax(0, 1fr) 44px;
        grid-template-areas: 'scr scr' 'info x' 'keys keys' 'seek seek';
      }
      .dock.bsh-player .dk-keys { justify-content: center; }
      .dock.bsh-player .dk-keys .rc-k { width: 66px; }
    }
  `;
  document.head.append(style);

  let toastTimer;
  function toast(message, error = false) {
    let element = document.querySelector('.bsh-toast');
    if (!element) {
      element = document.createElement('div');
      element.className = 'bsh-toast';
      element.setAttribute('role', 'status');
    }
    (document.fullscreenElement || document.body).append(element);
    element.dataset.error = String(error);
    element.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.remove(), error ? 7000 : 4000);
  }

  function currentTrack(kind) {
    let link;
    let title;
    if (kind.startsWith('duel-')) {
      const card = document.querySelectorAll('#duel .arena .scrw')[kind === 'duel-a' ? 0 : 1];
      const thumb = card?.querySelector('img.fg')?.getAttribute('src');
      title = card?.querySelector('.tag b')?.textContent.trim();
      return thumb ? { thumb, title: title || 'Track' } : null;
    } else if (kind === 'songs') {
      if (!document.querySelector('.dock.up')) return null;
      const selected = document.querySelector('.songs li.on');
      link = selected?.querySelector('a[href^="/clip/"]');
      title = document.querySelector('.dk-ti')?.textContent.trim();
    } else {
      const stage = document.querySelector('.rc-k.prog')?.closest('.stage-col');
      link = stage?.querySelector('.l3 .by a[href^="/clip/"]');
      title = stage?.querySelector('.l3 .ti')?.textContent.trim();
    }
    const id = link?.getAttribute('href').match(/^\/clip\/(\d+)\/?$/)?.[1];
    return id ? { id, title: title || 'Track' } : null;
  }

  const pendingLikes = new Set();
  const resolvingLikes = new Set();
  let duelSongs;
  async function resolveDuelTrack(track) {
    // Duel cards have no post permalink. Resolve the exact thumbnail against
    // the public song catalogue; never mistake a video asset ID for a post ID.
    const catalogue = () => fetch('/api/songs', { signal: AbortSignal.timeout(15000) }).then(response => {
      if (!response.ok) throw new Error('Could not load the duel track. Please try again.');
      return response.json();
    }).then(data => data.songs);
    try {
      duelSongs ||= catalogue();
      let matches = (await duelSongs).filter(song => song.thumb === track.thumb);
      if (!matches.length) {
        duelSongs = catalogue(); // A newly submitted song may not be cached yet.
        matches = (await duelSongs).filter(song => song.thumb === track.thumb);
      }
      if (matches.length !== 1 || !/^\d+$/.test(matches[0].id)) {
        throw new Error('Could not identify this duel track safely. Please try again later.');
      }
      return { id: matches[0].id, title: track.title };
    } catch (error) {
      duelSongs = null;
      throw error;
    }
  }
  function requestLike(track) {
    return new Promise((resolve, reject) => {
      const key = requestPrefix + crypto.randomUUID();
      const nonce = key.slice(requestPrefix.length);
      let tab;
      let listener;
      let timer;
      let settled = false;
      const cancel = () => finish({ ok: false, message: 'Like request cancelled because the page was closed.' });
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('pagehide', cancel);
        if (listener !== undefined) GM_removeValueChangeListener(listener);
        GM_deleteValue(key);
        tab?.close();
        result.ok ? resolve(result.message) : reject(new Error(result.message));
      };
      try {
        window.addEventListener('pagehide', cancel, { once: true });
        listener = GM_addValueChangeListener(key, (_key, _old, value) => {
          if (value?.phase === 'done' && value.id === track.id) finish(value);
        });
        GM_setValue(key, { id: track.id, phase: 'requested', expiresAt: Date.now() + requestLifetime });
        timer = setTimeout(() => finish({ ok: false, message: 'Could not confirm the like. It may have succeeded; check X or retry safely.' }), requestLifetime);
        tab = GM_openInTab(`https://x.com/i/status/${track.id}#bsh-like=${nonce}`, { active: false, setParent: true });
        tab.onclose = () => finish({ ok: false, message: 'X tab closed before the like was confirmed.' });
      } catch (error) {
        finish({ ok: false, message: error.message });
      }
    });
  }

  async function likeTrack(kind) {
    let track = currentTrack(kind);
    if (!track || resolvingLikes.has(kind)) return;
    if (track.thumb) {
      resolvingLikes.add(kind);
      syncLikes();
      toast(`Liking ${track.title} on X…`);
      try {
        track = await resolveDuelTrack(track);
      } catch (error) {
        toast(error.message, true);
        return;
      } finally {
        resolvingLikes.delete(kind);
        syncLikes();
      }
    }
    if (pendingLikes.has(track.id)) return;
    pendingLikes.add(track.id);
    resolvingLikes.add(kind);
    syncLikes();
    toast(`Liking ${track.title} on X…`);
    try {
      const message = await requestLike(track);
      toast(`${message}: ${track.title}`);
    } catch (error) {
      toast(error.message, true);
    } finally {
      pendingLikes.delete(track.id);
      resolvingLikes.delete(kind);
      syncLikes();
    }
  }

  function syncLikes() {
    for (const [kind, anchor] of [
      ['chart', document.querySelector('.rc-k.prog')],
      ['songs', document.querySelector('.dk-keys .next')],
      ['duel-a', document.querySelector('#duel .picks .pick.a')],
      ['duel-b', document.querySelector('#duel .picks .pick.b')],
    ]) {
      if (!anchor) continue;
      let button = anchor.parentElement.querySelector(`.bsh-like[data-kind="${kind}"]`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'rc-k bsh-like';
        button.dataset.kind = kind;
        button.innerHTML = '<svg viewBox="0 0 11 9" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 0h3v1h3V0h3v1h1v4h-1v1H9v1H8v1H7v1H4V8H3V7H2V6H1V5H0V1h1z"/></svg><span>Like</span>';
        const side = kind.startsWith('duel-') ? kind.slice(-1).toUpperCase() : null;
        button.setAttribute('aria-label', side ? `Like clip ${side} on X` : 'Like this track on X');
        button.title = side ? `Like clip ${side} on X` : 'Like on X (L)';
        if (!side) button.setAttribute('aria-keyshortcuts', 'L');
        button.addEventListener('click', () => likeTrack(kind));
      }
      // SlopHits replaces/reorders the keyed voting buttons for each new pair.
      // Restore adjacency even when our existing Like buttons survive that render.
      if (anchor.nextElementSibling !== button) anchor.after(button);
      const track = currentTrack(kind);
      button.disabled = !track || resolvingLikes.has(kind) || pendingLikes.has(track.id);
    }
    const shortcuts = document.querySelector('.rc-keys');
    if (shortcuts && !shortcuts.querySelector('.bsh-like-hint')) {
      const hint = document.createElement('span');
      hint.className = 'bsh-like-hint';
      hint.innerHTML = '<kbd>L</kbd>like on X';
      shortcuts.append(hint);
    }
  }

  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'l' || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    if (location.pathname !== '/' || !['', '#chart'].includes(location.hash)) return;
    if (!currentTrack('chart')) return;
    event.preventDefault();
    likeTrack('chart');
  });

  let activeDock = null;
  let returnFocus = null;
  let pendingOpener = null;
  const focusable = () => activeDock ? [...activeDock.querySelectorAll(
    'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden') : [];

  function dismiss() {
    // Keep SlopHits in charge of stopping playback and clearing its selected song.
    activeDock?.querySelector('.dk-x')?.click();
  }

  const clipSources = new Map();
  const videoSources = new WeakMap();
  function matchClipQuality(dock) {
    const video = dock?.classList.contains('up') && dock.querySelector('video');
    const track = video && currentTrack('songs');
    if (!track || !video.src) return;
    const previous = videoSources.get(video);
    if (previous?.id === track.id && [previous.original, previous.source].includes(video.src)) return;
    const state = { id: track.id, original: video.src, source: null };
    videoSources.set(video, state);
    if (!clipSources.has(track.id)) {
      const source = fetch('/clip/' + track.id).then(async response => {
        if (!response.ok) throw new Error('Clip page unavailable');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const src = doc.querySelector('video[src]')?.getAttribute('src');
        const url = src && new URL(src, location.origin);
        if (!url || url.protocol !== 'https:') throw new Error('Clip video unavailable');
        return url.href;
      });
      clipSources.set(track.id, source);
      source.catch(() => clipSources.delete(track.id));
    }
    clipSources.get(track.id).then(source => {
      if (videoSources.get(video) !== state) return;
      if (!video.isConnected || !dock.classList.contains('up') || currentTrack('songs')?.id !== state.id || video.src !== state.original) {
        videoSources.delete(video);
        return;
      }
      state.source = source;
      if (source === video.src) return;
      const time = video.currentTime;
      const paused = video.paused;
      const restore = () => {
        if (videoSources.get(video) !== state || video.src !== source || !dock.classList.contains('up')) return;
        if (Number.isFinite(time)) video.currentTime = time;
        if (!paused) video.play().catch(() => {});
      };
      video.addEventListener('loadedmetadata', restore, { once: true });
      video.addEventListener('error', () => {
        if (videoSources.get(video) !== state || video.src !== source) return;
        video.removeEventListener('loadedmetadata', restore);
        video.src = state.original;
        video.addEventListener('loadedmetadata', () => {
          if (videoSources.get(video) !== state || !dock.classList.contains('up')) return;
          video.currentTime = time;
          if (!paused) video.play().catch(() => {});
        }, { once: true });
      }, { once: true });
      video.src = source;
    }).catch(() => { /* Keep native playback if the clip page is unavailable. */ });
  }

  function sync() {
    syncLikes();
    const dock = /^\/songs\/?$/.test(location.pathname) ? document.querySelector('.dock') : null;
    matchClipQuality(dock);
    if (dock && !dock.classList.contains('bsh-player')) dock.classList.add('bsh-player');
    const next = dock?.classList.contains('up') ? dock : null;
    if (next === activeDock) return;
    if (activeDock) {
      activeDock.removeAttribute('role');
      activeDock.removeAttribute('aria-modal');
      document.documentElement.classList.remove('bsh-player-open');
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
    activeDock = next;
    if (activeDock) {
      returnFocus = pendingOpener || document.activeElement;
      pendingOpener = null;
      activeDock.setAttribute('role', 'dialog');
      activeDock.setAttribute('aria-modal', 'true');
      document.documentElement.classList.add('bsh-player-open');
      activeDock.querySelector('.dk-x')?.focus({ preventScroll: true });
    }
  }

  document.addEventListener('keydown', event => {
    if (!activeDock || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    const key = event.key.toLowerCase();
    // Let the focused seek slider retain its native arrow-key seeking.
    if (event.target.closest?.('[role="slider"]') && ['arrowleft', 'arrowright'].includes(key)) return;
    const selectors = {
      ' ': '.dk-keys .play', arrowleft: '.dk-keys .prev', '<': '.dk-keys .prev', ',': '.dk-keys .prev',
      arrowright: '.dk-keys .next', '>': '.dk-keys .next', '.': '.dk-keys .next',
      m: '.dk-scr .snd', f: '.dk-scr .fsk', l: '.dk-keys .bsh-like',
    };
    const selector = selectors[key];
    if (!selector) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) activeDock.querySelector(selector)?.click();
  }, true);

  // SlopHits' pointer handling can leave document.activeElement on the body.
  // Capture the actual opener before its click handler opens the player.
  document.addEventListener('click', event => {
    if (!activeDock && /^\/songs\/?$/.test(location.pathname)) {
      pendingOpener = event.target.closest?.('button.pk') || null;
    }
  }, true);
  document.addEventListener('click', event => {
    if (activeDock && event.target === activeDock && !document.fullscreenElement) dismiss();
  });
  document.addEventListener('keydown', event => {
    if (!activeDock || document.fullscreenElement) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    } else if (event.key === 'Tab') {
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !activeDock.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeDock.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    }
  }, true);

  // Nuxt replaces the dock during navigation and toggles .up when a song opens.
  new MutationObserver(sync).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'href', 'src'],
  });
  sync();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSlopHits, { once: true });
  } else {
    startSlopHits();
  }
})();
