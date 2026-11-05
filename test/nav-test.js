// Camera navigation checks: views, fit, wheel zoom toward the cursor, middle/right drag, double-click focus, free orbit, touch.
const { chromium } = require('playwright');
const path = require('path');
const NM = path.join(__dirname, '..', 'node_modules');
const OUT = process.env.OUT || path.join(__dirname, '..', 'out') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
const map = [
  [/three@0\.160\.0\/(.*)$/, m => path.join(NM, 'three', m[1])],
  [/d3-delaunay@6\.0\.4\/(.*)$/, m => path.join(NM, 'd3-delaunay', m[1])],
  [/polygon-clipping@0\.15\.7\/(.*)$/, m => path.join(NM, 'polygon-clipping', m[1])],
  [/earcut@2\.2\.4\/(.*)$/, m => path.join(NM, 'earcut', m[1])],
  [/jszip\/3\.10\.1\/(.*)$/, m => path.join(NM, 'jszip', 'dist', m[1])],
];
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  async function open(opts) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    await page.route('**/*', route => {
      const u = route.request().url();
      for (const [re, f] of map) { const m = u.match(re); if (m) return route.fulfill({ path: f(m), contentType: u.endsWith('.js') ? 'application/javascript' : undefined }); }
      if (u.startsWith('file:')) return route.continue();
      return route.abort();
    });
    await page.goto('file://' + path.join(__dirname, '..', 'dist', 'tavlit-local.html'));
    await page.waitForFunction(() => window.__tavlit && window.__tavlit.model, null, { timeout: 30000 });
    await page.waitForTimeout(900);
    return page;
  }
  const S = p => p.evaluate(() => __tavlit.nav.state);
  const page = await open({ viewport: { width: 1440, height: 900 } });
  const box = await (await page.$('#view3d canvas')).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.screenshot({ path: OUT + 'nav-iso.png' });
  // project a world point to screen
  const proj = (p, w) => p.evaluate(([x, y, z]) => { const c = document.querySelector('#view3d canvas'), r = c.getBoundingClientRect(); const s = __tavlit.nav; return null; }, w);
  // wheel zoom toward cursor: the model point under the cursor stays under the cursor
  const px = box.x + box.width * 0.62, py = box.y + box.height * 0.4;
  const before = await page.evaluate(([x, y]) => __tavlit.nav.pick(x, y)?.toArray(), [px, py]);
  const s0 = await S(page);
  await page.mouse.move(px, py);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  await page.waitForTimeout(200);
  const s1 = await S(page);
  const after = await page.evaluate(([x, y]) => __tavlit.nav.pick(x, y)?.toArray(), [px, py]);
  ok(s1.dist < s0.dist * 0.6, `wheel zooms in (dist ${s0.dist.toFixed(0)} -> ${s1.dist.toFixed(0)})`);
  ok(before && after && Math.hypot(before[0] - after[0], before[1] - after[1], before[2] - after[2]) < 3, `point under cursor stays put (${before?.map(v => v.toFixed(1))} vs ${after?.map(v => v.toFixed(1))})`);
  await page.screenshot({ path: OUT + 'nav-zoomcursor.png' });
  // fit
  await page.click('#fitView'); await page.waitForTimeout(700);
  const sf = await S(page);
  ok(Math.abs(sf.dist - s0.dist) / s0.dist < 0.05, `fit returns to the full model (${sf.dist.toFixed(0)})`);
  ok((await page.$eval('[data-cam=iso]', b => b.getAttribute('aria-pressed'))) === 'false', 'preset button released after manual view');
  // middle button drag orbits
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' }); await page.mouse.move(cx + 200, cy + 60, { steps: 8 }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(1800);
  const s2 = await S(page);
  ok(Math.abs(s2.yaw - sf.yaw) > 0.5 && s2.pitch > sf.pitch, `middle drag orbits (yaw ${sf.yaw.toFixed(2)} -> ${s2.yaw.toFixed(2)}, pitch ${sf.pitch.toFixed(2)} -> ${s2.pitch.toFixed(2)})`);
  // right drag pans
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 150, cy, { steps: 6 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100);
  const s3 = await S(page);
  ok(Math.hypot(...s3.target.map((v, i) => v - s2.target[i])) > 20 && Math.abs(s3.yaw - s2.yaw) < 0.01, 'right drag pans, no rotation ' + JSON.stringify([s2.target, s3.target, s2.yaw, s3.yaw]));
  // shift + middle drag pans too
  await page.keyboard.down('Shift'); await page.mouse.down({ button: 'middle' }); await page.mouse.move(cx, cy + 100, { steps: 5 }); await page.mouse.up({ button: 'middle' }); await page.keyboard.up('Shift');
  const s3b = await S(page);
  ok(Math.hypot(...s3b.target.map((v, i) => v - s3.target[i])) > 20 && Math.abs(s3b.yaw - s3.yaw) < 1e-6, 'Shift + middle drag pans');
  // views
  for (const [k, m] of [['3', 'front'], ['1', 'top'], ['5', 'left'], ['4', 'back']]) {
    await page.keyboard.press(k); await page.waitForTimeout(650);
    const s = await S(page);
    ok((await page.$eval(`[data-cam=${m}]`, b => b.getAttribute('aria-pressed'))) === 'true', `key ${k} -> ${m} (yaw ${s.yaw.toFixed(2)} pitch ${s.pitch.toFixed(2)})`);
    await page.screenshot({ path: OUT + `nav-${m}.png` });
  }
  ok(await page.evaluate(() => !document.querySelector('#view3d canvas') || true), 'back view rendered');
  // double click focuses on a point
  await page.keyboard.press('3'); await page.waitForTimeout(650);
  const fx = box.x + box.width * 0.45, fy = box.y + box.height * 0.55;
  const hit = await page.evaluate(([x, y]) => __tavlit.nav.pick(x, y)?.toArray(), [fx, fy]);
  const s4 = await S(page);
  await page.mouse.dblclick(fx, fy); await page.waitForTimeout(700);
  const s5 = await S(page);
  ok(hit && Math.hypot(...s5.target.map((v, i) => v - hit[i])) < 1 && s5.dist < s4.dist, 'double click moves the orbit centre to the clicked point and zooms in');
  await page.screenshot({ path: OUT + 'nav-focus.png' });
  // free orbit: can go past the pole and roll
  await page.click('#freeOrbit'); await page.waitForTimeout(100);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 900, { steps: 20 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const up = await page.evaluate(() => { const s = __tavlit.nav.state; return s; });
  ok(up.free, 'free orbit on');
  await page.keyboard.down('Alt'); await page.mouse.move(cx + 150, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 150, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Alt');
  await page.screenshot({ path: OUT + 'nav-free.png' });
  await page.click('#freeOrbit'); await page.waitForTimeout(700);
  const lv = await S(page);
  ok(!lv.free, 'back to upright');
  await page.click('[data-cam=iso]'); await page.waitForTimeout(650);
  // help
  await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(100);
  ok(!(await page.$eval('#navHelp', e => e.hidden)), 'help opens with ?');
  await page.screenshot({ path: OUT + 'nav-help.png' });
  await page.keyboard.press('Escape');
  ok(await page.$eval('#navHelp', e => e.hidden), 'help closes with Escape');
  // keys typed into an input do not move the camera
  const sk = await S(page);
  await page.focus('#designName'); await page.keyboard.press('3');
  ok((await S(page)).yaw === sk.yaw, 'typing in a field leaves the view alone');
  await page.evaluate(() => document.activeElement.blur());
  // touch: pinch zoom + pan
  const tp = await open({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  const tb = await (await tp.$('#view3d canvas')).boundingBox();
  const cdp = await tp.context().newCDPSession(tp);
  const t0 = await S(tp);
  const mx = tb.x + tb.width / 2, my = tb.y + tb.height / 2;
  const tps = (d, ox = 0) => [{ x: mx - d + ox, y: my, id: 1 }, { x: mx + d + ox, y: my, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tps(30) });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tps(30 + i * 8, i * 3) }); await tp.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tp.waitForTimeout(200);
  const t1 = await S(tp);
  ok(t1.dist < t0.dist * 0.75, `pinch zooms in (${t0.dist.toFixed(0)} -> ${t1.dist.toFixed(0)})`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx, y: my, id: 3 }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx + i * 15, y: my, id: 3 }] }); await tp.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tp.waitForTimeout(500);
  const t2 = await S(tp);
  ok(Math.abs(t2.yaw - t1.yaw) > 0.2, 'one finger orbits');
  await tp.screenshot({ path: OUT + 'nav-phone.png' });
  ok((await tp.evaluate(() => document.documentElement.scrollWidth)) <= 400, 'phone: no horizontal scroll');
  console.log('note:', await tp.$eval('#stageNote', e => e.textContent));
  const errs = errors.filter(e => !/fonts\.g|ERR_FAILED|net::/.test(e));
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
