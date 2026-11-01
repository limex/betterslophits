const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The installed userscript runs on real SlopHits. Only reserved fixture post
// URLs are used; all X traffic for those URLs is intercepted locally.
module.exports = async function runLikesSmoke(browser) {
  const context = browser.contexts()[0];
  const session = await browser.newBrowserCDPSession();
  const waiting = context.waitForEvent('page');
  const { targetId } = await session.send('Target.createTarget', { url: 'about:blank', background: true });
  const page = await waiting;
  page.setDefaultTimeout(10000);
  const results = [];
  const states = new Map();
  const helpers = new Set();
  const existingPages = new Set(context.pages());
  const errors = [];
  const artifactDir = path.join(__dirname, '../.artifacts/likes');
  fs.mkdirSync(artifactDir, { recursive: true });
  const app = () => execFileSync('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js'], { encoding: 'utf8' }).trim();
  const initialApp = app();
  // Guard every post navigation from a newly opened helper as well as fixtures:
  // a SlopHits re-render must never turn a test click into a real X action.
  const fixturePattern = /^https:\/\/x\.com\/[^/]+\/status\/\d+(?:[?#].*)?$/;
  const handler = async route => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-1);
    const state = states.get(id);
    // X also forwards requests through its service worker, which has no frame.
    const owner = route.request().serviceWorker() ? null : route.request().frame().page();
    if (owner && existingPages.has(owner)) return route.continue();
    if (owner) helpers.add(owner);
    if (!state) return route.abort();
    if (route.request().method() === 'POST') {
      state.clicks++;
      if (['success', 'delayed'].includes(state.mode)) state.liked = true;
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ json: { ok: state.liked } });
    }
    state.loads++;
    if (state.mode === 'login') return route.fulfill({ contentType: 'text/html', body: '<button data-testid="loginButton">Log in</button>' });
    if (state.mode === 'empty') return route.fulfill({ contentType: 'text/html', body: '<p>Loading fixture</p>' });
    // A quote timestamp precedes the main timestamp. X also drops the hash
    // during canonicalization. Both caused real integration bugs.
    const html = `<!doctype html><html><body>
      <article><a href="/test/status/111"><time>Other post</time></a><button data-testid="unlike">Unlike</button></article>
      <article><time>Quoted post without permalink</time><a href="/test/status/${id}"><time>Target post</time></a>
      <button data-testid="${state.liked && state.mode !== 'delayed' ? 'unlike' : 'like'}" onclick="this.dataset.testid='unlike';fetch('/test/status/${id}',{method:'POST'})">Like</button></article>
      ${state.mode === 'delayed' && state.liked ? '<button data-testid="loginButton">Transient login</button><script>setTimeout(()=>{document.querySelector("article:last-of-type button").dataset.testid="unlike";},4500);setTimeout(()=>document.querySelector("[data-testid=loginButton]").remove(),1500)</script>' : ''}
      <script>setTimeout(()=>history.replaceState(null,'','/test/status/${id}'),500)</script>
      </body></html>`;
    return route.fulfill({ contentType: 'text/html', body: html });
  };
  await context.route(fixturePattern, handler);
  // An existing X service worker can serve its cached app shell instead of a
  // routed fixture on the first helper navigation. Bypass it for test helpers
  // only; never unregister or modify the user's worker or existing X tabs.
  const prepareHelper = async helper => {
    try {
      await helper.waitForURL(/^https:\/\/x\.com\/(?:i|test)\/status\/900000000000000000\d(?:[?#].*)?$/, { waitUntil: 'domcontentloaded', timeout: 10000 });
      helpers.add(helper);
      const helperSession = await context.newCDPSession(helper);
      helper.once('close', () => helperSession.detach().catch(() => {}));
      await helperSession.send('Network.setBypassServiceWorker', { bypass: true });
      await helper.waitForLoadState('domcontentloaded');
      const fixtureLoaded = await helper.evaluate(() => !!document.querySelector('article a[href^="/test/status/"], [data-testid="loginButton"]') || document.body?.textContent === 'Loading fixture');
      if (!fixtureLoaded && !helper.isClosed()) await helper.reload({ waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (!helper.isClosed() && /900000000000000000\d/.test(helper.url())) errors.push(error.message);
    }
  };
  context.on('page', prepareHelper);
  page.on('pageerror', error => errors.push(error.message));
  const test = async (name, fn) => {
    try {
      await fn();
      if (initialApp !== 'com.google.Chrome') assert.notEqual(app(), 'com.google.Chrome');
      results.push({ name, status: 'PASS' });
    } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); }
    console.log(JSON.stringify(results.at(-1)));
  };
  const target = async (index, mode = 'success', kind = 'chart') => {
    const id = '900000000000000000' + index;
    states.set(id, { mode, liked: mode === 'already', loads: 0, clicks: 0 });
    await page.evaluate(({ id, kind }) => {
      const link = document.querySelector(kind === 'chart' ? '.stage-col .l3 .by a[href^="/clip/"]' : '.songs li.on a[href^="/clip/"]');
      link.setAttribute('href', '/clip/' + id);
    }, { id, kind });
    return states.get(id);
  };
  const receipt = async error => {
    await page.waitForFunction(() => {
      const element = document.querySelector('.bsh-toast');
      return element && !element.textContent.startsWith('Liking ');
    }, null, { timeout: 65000 });
    assert.equal(await page.locator('.bsh-toast').getAttribute('data-error'), String(error), await page.locator('.bsh-toast').textContent());
    return page.locator('.bsh-toast').textContent();
  };
  const cdp = await context.newCDPSession(page);
  const checkLayout = async kind => {
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const group = kind === 'chart' ? '.rc' : '.dk-keys';
      const anchor = kind === 'chart' ? '.prog' : '.next';
      const boxes = await page.locator(group).evaluate((e, anchor) => ({
        like: e.querySelector('.bsh-like').getBoundingClientRect().toJSON(),
        anchor: e.querySelector(anchor).getBoundingClientRect().toJSON(),
      }), anchor);
      assert(Math.abs(boxes.like.y - boxes.anchor.y) < 1);
      assert(boxes.like.x >= boxes.anchor.right);
      assert(boxes.like.right <= width);
      await page.screenshot({ path: path.join(artifactDir, `${kind}-${width}.png`) });
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  };
  try {
    await page.goto('https://slophits.com/#chart', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.rc > .bsh-like');
    await test('Intro cannot like a stale song', async () => {
      if (!await page.locator('.l3-film').count()) await page.getByRole('button', { name: 'Watch the 26 s intro', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rc > .bsh-like').disabled);
      await page.locator('.rc-k.prog').focus();
      await page.keyboard.press('l');
      assert.equal(states.size, 0);
    });
    await page.getByRole('button', { name: 'Stop the intro', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.rc > .bsh-like').disabled);
    // Stop automatic track changes while changing only the test permalink.
    if (await page.locator('.rc-k.prog').getAttribute('aria-pressed') === 'true') await page.locator('.rc-k.prog').click();
    await test('Chart Like button and L hint follow existing controls', async () => {
      assert(await page.locator('.rc-k.prog + .bsh-like').count());
      assert.equal(await page.locator('.bsh-like-hint').evaluate(e => e.previousElementSibling.textContent), 'Ffull screen');
    });
    await test('Chart Like stays right of Programme on desktop and mobile', () => checkLayout('chart'));
    await test('Confirmed like requires fresh X state, not optimistic button change', async () => {
      const state = await target(1);
      await page.locator('.rc > .bsh-like').click();
      assert(await page.locator('.rc > .bsh-like').isDisabled());
      assert.match(await receipt(false), /^Liked on X:/);
      assert.equal(state.clicks, 1);
      assert(state.loads >= 2);
    });
    await test('Reload waits for delayed saved state despite transient login UI', async () => {
      const state = await target(0, 'delayed');
      await page.locator('.rc > .bsh-like').click();
      assert.match(await receipt(false), /^Liked on X:/);
      assert.equal(state.clicks, 1);
      assert(state.loads >= 2);
    });
    await test('Already-liked post never clicks Unlike', async () => {
      const state = await target(2, 'already');
      await page.locator('.rc > .bsh-like').click();
      assert.match(await receipt(false), /^Already liked on X:/);
      assert.equal(state.clicks, 0);
    });
    await test('Failed persistence produces an error, never a success toast', async () => {
      const state = await target(3, 'failure');
      await page.locator('.rc > .bsh-like').click();
      assert.match(await receipt(true), /may have succeeded/);
      assert.equal(state.clicks, 1);
    });
    await test('Logged-out X gives an actionable error', async () => {
      await target(4, 'login');
      await page.locator('.rc > .bsh-like').click();
      assert.match(await receipt(true), /Sign in to X/);
    });
    await test('L shortcut deduplicates requests while pending', async () => {
      const state = await target(5);
      const helperCount = helpers.size;
      await page.locator('.rc-k.prog').focus();
      await page.keyboard.press('l');
      await page.keyboard.press('l');
      await receipt(false);
      assert.equal(state.clicks, 1);
      assert.equal(helpers.size, helperCount + 1);
      assert(state.loads >= 2);
    });
    await test('Typing, modifiers, composition, and key repeat do not like', async () => {
      const state = await target(6);
      await page.locator('input').first().focus();
      await page.keyboard.press('l');
      await page.locator('.rc-k.prog').focus();
      await page.evaluate(() => {
        for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, ...extra }));
        }
      });
      await page.waitForTimeout(500);
      assert.equal(state.loads, 0);
    });
    await test('Track changes cannot redirect an in-flight like or its receipt', async () => {
      const originalTitle = await page.locator('.stage-col .l3 .ti').textContent();
      const first = await target(8);
      await page.locator('.rc > .bsh-like').click();
      const second = await target(9);
      await page.locator('.stage-col .l3 .ti').evaluate(e => { e.textContent = 'Next fixture track'; });
      assert((await receipt(false)).includes(originalTitle));
      assert.equal(first.clicks, 1);
      assert.equal(second.loads, 0);
    });
    await test('Closing a helper produces an error and permits retry', async () => {
      await target(6, 'empty');
      const nextPage = context.waitForEvent('page');
      await page.locator('.rc > .bsh-like').click();
      const helper = await nextPage;
      await helper.close();
      assert.match(await receipt(true), /closed before/);
      assert(await page.locator('.rc > .bsh-like').isEnabled());
    });
    await page.goto('https://slophits.com/songs?view=tiles&size=l', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('button.pk').first().click();
    await test('Songs Like follows Next and L likes the selected song', async () => {
      assert(await page.locator('.dk-keys .next + .bsh-like').count());
      const state = await target(7, 'success', 'songs');
      await page.locator('.dk-x').focus();
      await page.keyboard.press('l');
      await receipt(false);
      assert.equal(state.clicks, 1);
    });
    await test('Songs Like fits beside Next on desktop and mobile', () => checkLayout('songs'));
    await test('Helper tabs close after their result', async () => {
      await page.waitForTimeout(1000);
      assert([...helpers].every(helper => helper.isClosed()));
    });
    await test('No uncaught UI errors', async () => assert.deepEqual(errors, []));
  } finally {
    for (const helper of helpers) if (!helper.isClosed()) await helper.close();
    context.off('page', prepareHelper);
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await context.unroute(fixturePattern, handler);
    await session.send('Target.closeTarget', { targetId }).catch(() => {});
    await session.detach();
    fs.writeFileSync(path.join(artifactDir, 'results.json'), JSON.stringify({ mockX: true, initialApp, finalApp: app(), states: Object.fromEntries(states), results }, null, 2));
  }
  return results.every(result => result.status === 'PASS');
};
