# Better SlopHits

Install `better-slop-hits.user.js` in Tampermonkey on regular Google Chrome, using the user's existing profile. Chrome Beta is not the target browser. It runs on SlopHits so that navigation into `/songs` works without a reload.

The songs player opens as a centered lightbox with a dimmed backdrop. Its video is 776 × 436.5 pixels on a sufficiently large desktop viewport, matching the reference clip page, and shrinks to fit smaller screens. Song details, transport buttons, and the seek bar appear below the video. The existing player and playback controls remain in use.

Close with the existing × button, Escape, or a click outside the panel. Closing uses SlopHits' own close action to stop playback. Keyboard focus stays inside the open player and returns to the opener on close; background scrolling is locked while open. Escape in native fullscreen remains the browser's fullscreen exit action.

X liking is deferred. This script has no X integration or additional permissions.

Versions use `YYYY-MM-DD.NN` (Europe/Vienna date and a two-digit daily release number). Current release: `2026-11-01.01`.

## Smoke tests

Run `npm ci`, then `npm run check` and `npm run test:smoke` on macOS. Install the current userscript in regular Chrome first. Enable remote debugging at `chrome://inspect/#remote-debugging` and approve the initial connection prompt.

The runner attaches to regular Chrome using its `DevToolsActivePort` file. It tests the installed Tampermonkey script on the live website, without injecting the local source or launching another browser. It opens a temporary background tab, uses page-only viewport emulation, and closes that tab afterward. The shared browser window is not resized or activated. When another app was in front at startup, the suite checks after each enabled test that Chrome has not taken foreground focus, using a read-only macOS AppKit query. Tests play audio/video and require the website and media sources to be available.

Native fullscreen is explicitly skipped in the default background run because it requires foreground interaction. Only when you are ready for Chrome to take focus, opt in with `npm run test:smoke -- --foreground` (or restart the runner with that option). Do not enable this mode while the user is working in another app.

Keep the runner open: press Enter to rerun through the same connection, or `q` to disconnect. A new runner process requires another Chrome approval. `npm run test:smoke:once` runs once and disconnects.

Assertions live in `tests/player-smoke.cjs`; connection management lives in `scripts/smoke-session.cjs`. Results and desktop/mobile screenshots are written to `.artifacts/smoke/` (excluded from Git). Failures are reported in `results.json` and result in a nonzero exit status. Install local source changes in Tampermonkey before rerunning.

The 2026-11-01.01 release passed all 14 checks in regular Chrome 156: installed-script startup, video sizing/control layout, pause/resume, next/previous, sound/seek, keyboard focus, native fullscreen, Escape/focus restoration, backdrop/close/reopen, portrait and landscape layout, list view, SPA navigation, and uncaught page errors. The smoke test exposed and verified a fix for focus restoration after pointer activation.
