// Headless check of the built player page.
//   node player/test-player.mjs [dist/sunshower.html] [--out out/delivery]
// Opens the page four ways (autoplay with sound allowed / reduced motion / phone portrait /
// autoplay blocked), exercises the controls and keyboard, fails on any console error, and writes
// screenshots (player_*.jpg) to look at.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, serve, launch, puppeteer, CHROME } from '../tools/env.mjs';

const argv = process.argv.slice(2);
let page_ = 'dist/sunshower.html', outDir = 'out/delivery';
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--out') outDir = argv[++i]; else page_ = argv[i]; }
const file = path.resolve(ROOT, page_);
outDir = path.resolve(ROOT, outDir); fs.mkdirSync(outDir, { recursive: true });
const srv = await serve(path.dirname(file));
const url = `${srv.url}/${path.basename(file)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`); if (!cond) failures++; };

async function open(browser, { reduced = false, w = 1600, h = 900, preload = null } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (preload) await page.evaluateOnNewDocument(preload);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => { if (!r.url().startsWith('blob:')) errors.push(`[requestfailed] ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  const t = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  return { page, errors, loadMs: Date.now() - t };
}
const state = (page) => page.evaluate(() => {
  const v = document.getElementById('v'), veil = document.getElementById('veil');
  return { paused: v.paused, muted: v.muted, t: v.currentTime, dur: v.duration, ended: v.ended, src: !!v.src,
    veil: !veil.hidden && !veil.classList.contains('gone'), veilEnd: veil.classList.contains('end'),
    go: !document.getElementById('go').hidden ? document.getElementById('golbl').textContent : null,
    unmute: document.getElementById('unmute').classList.contains('on'),
    chrome: document.getElementById('frame').classList.contains('show') };
});
const waitFor = (page, fn, ms = 20000) => page.waitForFunction(fn, { timeout: ms, polling: 100 }).then(() => true, () => false);

try {
  // ---------------------------------------------------------------- 1. autoplay allowed (env.mjs launches with no-user-gesture-required)
  console.log('1. autoplay with sound allowed');
  const b1 = await launch();
  let s;
  {
    const { page, errors, loadMs } = await open(b1);
    const s0 = await state(page);
    ok(s0.veil, `page loaded in ${loadMs} ms; title card visible on load`);
    const pi = await page.evaluate(() => { const p = document.getElementById('poster'); return { w: p.naturalWidth, h: p.naturalHeight, title: document.title, h1: document.querySelector('h1').textContent }; });
    ok(pi.w >= 960 && pi.h >= 520, `poster decoded (${pi.w}x${pi.h})`);
    ok(pi.h1 === 'Sunshower' && /Sunshower/.test(pi.title), `title "${pi.h1}" / <title> "${pi.title}"`);
    await page.screenshot({ path: path.join(outDir, 'player_loading.jpg'), quality: 88 });
    ok(await waitFor(page, () => !document.getElementById('go').hidden, 60000), 'reel unpacked, button offered during the title hold');
    s = await state(page); ok(s.paused && s.veil, 'title card holds before the film starts');
    const t0 = Date.now();
    ok(await waitFor(page, () => { const v = document.getElementById('v'); return !v.paused && v.currentTime > 0.4; }), 'film starts playing on its own');
    console.log(`       (started ${((Date.now() - t0) / 1000).toFixed(1)} s after the button appeared)`);
    s = await state(page);
    ok(!s.muted, 'plays with sound'); ok(!s.veil, 'title card gone'); ok(!s.unmute, 'no "Turn sound on" pill');
    await page.mouse.move(800, 450); await sleep(150); await page.mouse.move(820, 460); await sleep(500);
    await page.screenshot({ path: path.join(outDir, 'player_playing.jpg'), quality: 90 });
    await page.keyboard.press('k'); await sleep(150);
    ok((await state(page)).paused, 'K pauses');
    await page.evaluate(() => { document.getElementById('v').currentTime = 0.5; }); await sleep(200);
    await page.keyboard.press('ArrowRight'); await sleep(200);
    s = await state(page); ok(Math.abs(s.t - Math.min(5.5, s.dur - 0.05)) < 0.06, `ArrowRight seeks +5 s (t=${s.t.toFixed(2)})`);
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    s = await state(page); ok(s.t < Math.max(0.6, s.dur - 4.9), `ArrowLeft seeks -5 s (t=${s.t.toFixed(2)})`);
    await page.keyboard.press('m'); await sleep(100); ok((await state(page)).muted, 'M mutes');
    await page.keyboard.press('m'); await sleep(100); ok(!(await state(page)).muted, 'M unmutes');
    // seek bar click at 50 %
    const r = await page.evaluate(() => { const b = document.getElementById('rail').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; });
    await page.mouse.click(r.x + r.w * 0.5, r.y + 1); await sleep(250);
    s = await state(page); ok(Math.abs(s.t / s.dur - 0.5) < 0.04, `seek bar click -> ${(100 * s.t / s.dur).toFixed(1)} %`);
    await page.mouse.move(r.x + r.w * 0.62, r.y + 1); await sleep(300);
    await page.screenshot({ path: path.join(outDir, 'player_paused.jpg'), quality: 90 });
    await page.keyboard.press('Space'); await sleep(200);
    ok(!(await state(page)).paused, 'Space plays');
    ok(await waitFor(page, () => document.getElementById('v').ended, 30000), 'reaches the end');
    await sleep(1300);
    s = await state(page); ok(s.veil && s.veilEnd && s.go === 'Watch again', `end card shows "${s.go}"`);
    await page.screenshot({ path: path.join(outDir, 'player_end.jpg'), quality: 88 });
    await page.click('#go'); await sleep(600);
    s = await state(page); ok(!s.paused && s.t < 1.5, 'Watch again restarts');
    // phone-size layout
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await page.mouse.move(200, 400); await sleep(400);
    await page.screenshot({ path: path.join(outDir, 'player_phone.jpg'), quality: 85 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    ok(!overflow, 'no horizontal overflow at phone width');
    ok(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await page.close();
  }
  // ---------------------------------------------------------------- 2. reduced motion: no autoplay, the title card waits
  console.log('2. prefers-reduced-motion');
  {
    const { page, errors } = await open(b1, { reduced: true });
    ok(await waitFor(page, () => !document.getElementById('go').hidden), 'title card offers a button');
    let s = await state(page);
    ok(s.paused && s.go === 'Watch with sound', `no autoplay; button says "${s.go}"`);
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('grain')).display === 'none'), 'grain off');
    await page.screenshot({ path: path.join(outDir, 'player_title.jpg'), quality: 90 });
    await page.click('#go'); await sleep(800);
    s = await state(page); ok(!s.paused && !s.muted && !s.veil, 'Watch with sound plays with sound');
    ok(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await page.close();
  }
  // ---------------------------------------------------------------- phone portrait title (reduced motion so it waits)
  console.log('3. phone portrait');
  {
    const { page, errors } = await open(b1, { reduced: true, w: 390, h: 844 });
    ok(await waitFor(page, () => !document.getElementById('go').hidden), 'button offered');
    const lay = await page.evaluate(() => {
      const m = document.getElementById('mast').getBoundingClientRect(), f = document.getElementById('frame').getBoundingClientRect(),
        foot = document.getElementById('foot');
      return { mast: getComputedStyle(document.getElementById('mast')).display !== 'none' && m.height > 0, mastAbove: m.bottom <= f.top + 1,
        left: f.left, right: innerWidth - f.right, foot: getComputedStyle(foot).display !== 'none' && foot.getBoundingClientRect().top >= f.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    ok(lay.mast && lay.mastAbove, 'title sits above the frame');
    ok(lay.left >= 8 && lay.right >= 8, `side gutters ${lay.left.toFixed(0)} / ${lay.right.toFixed(0)} px`);
    ok(lay.foot, 'credit line under the frame');
    ok(!lay.overflow, 'no horizontal overflow');
    await page.screenshot({ path: path.join(outDir, 'player_phone_title.jpg'), quality: 88 });
    ok(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await page.close();
  }
  await b1.close();

  // ---------------------------------------------------------------- 4. autoplay with sound blocked (default Chrome policy)
  console.log('4. autoplay with sound blocked');
  const b2 = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=document-user-activation-required'] });
  {
    // Puppeteer runs page.evaluate with a user gesture, which would unlock sound; so watch the first
    // 'playing' event through the console and touch nothing until it has fired.
    let firstPlay = null;
    const played = new Promise((res) => { firstPlay = res; });
    const { page, errors } = await open(b2, { preload: () => document.addEventListener('playing', (e) => console.log('[test] playing muted=' + e.target.muted), true) });
    page.on('console', (m) => { const k = /^\[test\] playing muted=(\w+)/.exec(m.text()); if (k) firstPlay(k[1] === 'true'); });
    const mutedAtStart = await Promise.race([played, sleep(30000).then(() => null)]);
    ok(mutedAtStart === true, `starts muted on its own (first 'playing' muted=${mutedAtStart})`);
    await sleep(600);
    await page.mouse.move(700, 400); await sleep(120); await page.mouse.move(720, 410); await sleep(500);
    let s = await state(page);
    ok(s.muted && s.unmute, `muted with a "Turn sound on" pill (muted=${s.muted}, pill=${s.unmute})`);
    await page.screenshot({ path: path.join(outDir, 'player_muted.jpg'), quality: 90 });
    const tBefore = (await state(page)).t;
    await page.click('#unmute'); await sleep(400);
    s = await state(page); ok(!s.muted && !s.paused && !s.unmute && s.t < 1.2, `pill turns sound on and restarts from the top (t ${tBefore.toFixed(2)} -> ${s.t.toFixed(2)})`);
    ok(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await page.close();
  }
  await b2.close();
} finally { srv.close(); }
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
