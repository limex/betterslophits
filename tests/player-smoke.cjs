const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async function runSmoke(browser, { foreground = false } = {}) {
const artifactDir = require('node:path').join(__dirname, '../.artifacts/smoke');
fs.mkdirSync(artifactDir, {recursive:true});
const results = [];
// Page visibility is emulated by Playwright and does not identify the macOS
// foreground application. Read AppKit without activating or controlling apps.
const foregroundApp = () => execFileSync('osascript', ['-l', 'JavaScript', '-e',
  'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js'
], { encoding: 'utf8' }).trim();
const initialForegroundApp = foreground ? null : foregroundApp();
async function test(name, fn) {
  try {
    await fn();
    if (!foreground && initialForegroundApp !== 'com.google.Chrome') {
      assert.notEqual(foregroundApp(), 'com.google.Chrome', 'Chrome must not steal application focus');
    }
    results.push({name, status:'PASS'});
  }
  catch(e) { results.push({name, status:'FAIL', error:e.message}); }
  console.log(JSON.stringify(results.at(-1)));
}
  const session = await browser.newBrowserCDPSession();
  const context = browser.contexts()[0];
  const newPage = context.waitForEvent('page');
  const {targetId} = await session.send('Target.createTarget', {url:'about:blank', background:true});
  const page = await newPage;
  page.setDefaultTimeout(8000);
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  const viewport = (width,height) => cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  const wait = async predicate => page.waitForFunction(predicate);
  const open = async () => {await page.locator('button.pk').first().click();await wait(()=>document.querySelector('.dock')?.classList.contains('up'));};
  const closed = () => wait(()=>!document.querySelector('.dock')?.classList.contains('up')&&!document.documentElement.classList.contains('bsh-player-open'));
  const noLegend = async () => assert.equal(await page.locator('.bsh-player-shortcuts').count(), 0);
  const sameClipSource = async () => {
    const expected = await page.evaluate(async () => {
      const href = document.querySelector('.songs li.on a[href^="/clip/"]').getAttribute('href');
      const doc = new DOMParser().parseFromString(await (await fetch(href)).text(), 'text/html');
      return doc.querySelector('video').src;
    });
    await page.waitForFunction(src => {
      const v = document.querySelector('.dock video');
      return v?.currentSrc === src && v.readyState >= 1 && v.videoWidth > 0;
    }, expected);
    return page.locator('.dock video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight }));
  };
  try {
    // Native fullscreen requires activation; routine runs must not steal focus.
    if (foreground) await page.bringToFront();
    await viewport(1440,1000);
    await page.goto('https://slophits.com/songs?view=tiles&size=l&f=rest',{waitUntil:'domcontentloaded'});
    await test('Installed userscript runs on fresh load', async()=>{
      await page.locator('#bsh-player-style').waitFor({state:'attached'});
      assert.equal(await page.locator('#bsh-player-style').count(),1);
    });
    await test('Desktop lightbox size and controls below video', async()=>{
      await open();
      const g=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {video:r('.dk-scr'),info:r('.dk-info'),keys:r('.dk-keys'),panel:r('.dk-in'),role:document.querySelector('.dock').getAttribute('role'),locked:getComputedStyle(document.documentElement).overflow};});
      assert.equal(g.role,'dialog');assert.equal(g.locked,'hidden');assert.equal(g.video.width,776);
      assert(g.info.y>=g.video.bottom&&g.keys.y>=g.video.bottom);
      await page.screenshot({path:`${artifactDir}/desktop.png`});
    });
    await test('Lightbox uses the exact clip-page source at 1280x720 for Evil Plan', async()=>{
      assert.deepEqual(await sameClipSource(), { width: 1280, height: 720 });
    });
    await test('Pause and resume',async()=>{
      await wait(()=>!!document.querySelector('.dock video')?.readyState);
      if(await page.locator('.dock video').evaluate(v=>v.paused))await page.locator('.dk-keys .play').click();
      await wait(()=>!document.querySelector('.dock video').paused);
      await page.locator('.dk-keys .play').click();await wait(()=>document.querySelector('.dock video').paused);
    });
    await test('Next and previous tracks',async()=>{
      const title=await page.locator('.dk-ti').textContent();
      await page.locator('.dk-keys .next').click();await page.waitForFunction(t=>document.querySelector('.dk-ti').textContent!==t,title);
      await sameClipSource();
      await page.locator('.dk-keys .prev').click();await page.waitForFunction(t=>document.querySelector('.dk-ti').textContent===t,title);
      await sameClipSource();
    });
    await test('Sound toggle and seeking',async()=>{
      const sound=page.locator('.dk-scr .snd');const before=await sound.getAttribute('aria-pressed');await sound.click();assert.notEqual(await sound.getAttribute('aria-pressed'),before);await sound.click();
      await wait(()=>document.querySelector('.dock video')?.duration>10);
      await page.locator('.dk-seek .sk-bar').click({position:{x:100,y:5}});
      await wait(()=>document.querySelector('.dock video').currentTime>1);
    });
    await test('Songs lightbox has no shortcut legend', noLegend);
    await test('Lightbox Space, place arrows and M control the current player', async()=>{
      await page.locator('.dk-x').focus();
      const paused = await page.locator('.dock video').evaluate(v=>v.paused);
      await page.keyboard.press('Space');
      await page.waitForFunction(old=>document.querySelector('.dock video').paused!==old, paused);
      await page.keyboard.press('Space');
      await page.waitForFunction(old=>document.querySelector('.dock video').paused===old, paused);
      const title = await page.locator('.dk-ti').textContent();
      await page.keyboard.press('>');
      await page.waitForFunction(old=>document.querySelector('.dk-ti').textContent!==old, title);
      await page.keyboard.press('<');
      await page.waitForFunction(old=>document.querySelector('.dk-ti').textContent===old, title);
      await sameClipSource();
      const sound = await page.locator('.dk-scr .snd').getAttribute('aria-pressed');
      await page.keyboard.press('m');
      assert.notEqual(await page.locator('.dk-scr .snd').getAttribute('aria-pressed'), sound);
      await page.keyboard.press('m');
      assert.equal(await page.locator('.dk-scr .snd').getAttribute('aria-pressed'), sound);
    });
    await test('F routes to fullscreen control; modifiers, typing and repeats are ignored', async()=>{
      await page.evaluate(()=>{
        window.bshKeyClicks=[];
        window.bshKeyGuard=e=>{
          const button=e.target.closest('.fsk, .play, .bsh-like');
          if(button){window.bshKeyClicks.push(button.className);e.preventDefault();e.stopImmediatePropagation();}
        };
        document.addEventListener('click',window.bshKeyGuard,true);
      });
      try {
        await page.keyboard.press('f');
        await page.keyboard.press('Control+f');
        await page.evaluate(()=>{
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'f',repeat:true,bubbles:true}));
          const input=document.createElement('input');document.querySelector('.dk-in').append(input);input.focus();
          for(const key of ['f','l',' '])input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
          input.remove();
        });
        assert.deepEqual(await page.evaluate(()=>window.bshKeyClicks),['fsk']);
      } finally {
        await page.evaluate(()=>document.removeEventListener('click',window.bshKeyGuard,true));
      }
    });
    await test('Tab and Shift+Tab remain in dialog',async()=>{
      await page.locator('.dk-x').focus();await page.keyboard.press('Tab');assert(await page.locator('.dk-scr .fsk').evaluate(e=>e===document.activeElement));
      await page.keyboard.press('Shift+Tab');assert(await page.locator('.dk-x').evaluate(e=>e===document.activeElement));
    });
    if (foreground) await test('Native fullscreen enters and exits',async()=>{
      await page.locator('.dk-scr .fsk').click();await wait(()=>!!document.fullscreenElement);
      await page.locator('.dk-scr .fsk').click();await wait(()=>!document.fullscreenElement);
      assert(await page.locator('.dock').evaluate(e=>e.classList.contains('up')));
    });
    else results.push({name:'Native fullscreen enters and exits', status:'SKIP', reason:'Requires foreground interaction; opt in with --foreground'});
    await test('Escape closes, stops playback, restores focus and scroll',async()=>{
      await page.keyboard.press('Escape');await closed();
      assert(await page.evaluate(()=>[...document.querySelectorAll('.dock video')].every(v=>v.paused)));
      assert(await page.locator('button.pk').first().evaluate(e=>e===document.activeElement));
    });
    await test('Backdrop and close button dismiss; reopening works',async()=>{
      await open();await page.locator('.dock').click({position:{x:2,y:2}});await closed();
      await open();await page.locator('.dk-x').click();await closed();
    });
    for(const [width,height] of [[390,844],[844,390]])await test(`Responsive layout ${width}x${height}`,async()=>{
      await viewport(width,height);await open();
      const g=await page.locator('.dk-in').evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),overflow:e.scrollWidth>e.clientWidth}));
      assert(!g.overflow);assert(g.rect.left>=0&&g.rect.right<=width&&g.rect.top>=0&&g.rect.bottom<=height);
      await noLegend();
      await page.screenshot({path:`${artifactDir}/${width}x${height}.png`});
      await page.locator('.dk-x').click();await closed();
    });
    await viewport(1440,1000);
    await test('List view also opens lightbox',async()=>{
      await page.getByRole('button',{name:'List',exact:true}).click();await open();await page.locator('.dk-x').click();await closed();
    });
    await test('SPA chart navigation and return; no duplicate styles',async()=>{
      await page.locator('a[href="/#chart"]').first().click();await page.waitForURL('**/#chart', { waitUntil: 'domcontentloaded', timeout: 30000 });
      assert(!await page.locator('html').evaluate(e=>e.classList.contains('bsh-player-open')));
      await page.locator('a[href="/songs"]').first().click();await page.waitForURL('**/songs', { waitUntil: 'domcontentloaded', timeout: 30000 });await open();
      assert.equal(await page.locator('#bsh-player-style').count(),1);await page.locator('.dk-x').click();await closed();
    });
    await test('No uncaught page errors',async()=>assert.deepEqual(errors,[]));
  } finally {
    fs.writeFileSync(`${artifactDir}/results.json`,JSON.stringify({browser:browser.version(),mode:foreground?'foreground':'background',initialForegroundApp,finalForegroundApp:foreground?null:foregroundApp(),results,errors},null,2));
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(()=>{});
    await session.send('Target.closeTarget',{targetId}).catch(()=>{});
    await session.detach();
  }
  return results.every(r=>r.status!=='FAIL');
};
