// ==UserScript==
// @name         Better SlopHits
// @namespace    BetterSlopHits
// @version      2026-11-01.01
// @description  A larger, accessible lightbox player for the SlopHits song library.
// @match        https://slophits.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (document.getElementById('bsh-player-style')) return;

  const style = document.createElement('style');
  style.id = 'bsh-player-style';
  style.textContent = `
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

  function sync() {
    const dock = /^\/songs\/?$/.test(location.pathname) ? document.querySelector('.dock') : null;
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
    childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
  });
  sync();
})();
