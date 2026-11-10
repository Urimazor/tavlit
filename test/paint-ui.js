// manual colouring in the browser: pick pieces by tapping the 3D view, paint them, export, reset to automatic
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs');
const NM = path.join(__dirname, '..', 'node_modules');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/';
const map = [
  [/three@0\.160\.0\/(.*)$/, m => path.join(NM, 'three', m[1])],
  [/d3-delaunay@6\.0\.4\/(.*)$/, m => path.join(NM, 'd3-delaunay', m[1])],
  [/polygon-clipping@0\.15\.7\/(.*)$/, m => path.join(NM, 'polygon-clipping', m[1])],
  [/earcut@2\.2\.4\/(.*)$/, m => path.join(NM, 'earcut', m[1])],
  [/jszip\/3\.10\.1\/(.*)$/, m => path.join(NM, 'jszip', 'dist', m[1])],
];
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', route => {
    const u = route.request().url();
    for (const [re, f] of map) { const m = u.match(re); if (m) return route.fulfill({ path: f(m), contentType: u.endsWith('.js') ? 'application/javascript' : undefined }); }
    if (u.startsWith('file:')) return route.continue();
    return route.abort();
  });
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'tavlit-local.html'));
  await page.waitForFunction(() => window.__tavlit && window.__tavlit.model, null, { timeout: 20000 });
  await page.evaluate(() => __tavlit.nav.view('front', true));
  await page.waitForTimeout(600);
  const sec = page.locator('.sec-head', { hasText: 'צבעים' }); await sec.click();
  await page.getByRole('button', { name: 'בחירת חלקים' }).click();
  const cv = page.locator('#view3d canvas'), bb = await cv.boundingBox();
  // tap the centre and a point beside it; each tap should select the piece under it
  const taps = [[0.5, 0.5], [0.42, 0.5]];
  for (const [fx, fy] of taps) { await page.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy); await page.waitForTimeout(400); }
  const sel = await page.locator('.field-label', { hasText: 'נבחר' }).innerText().catch(() => '');
  ok(/2 חלקים נבחרו/.test(sel), 'two pieces picked by tapping: ' + sel);
  const before = await page.evaluate(() => __tavlit.model.pieces.map(c => c.band));
  const nb = await page.evaluate(() => __tavlit.state.color.bands.length);
  const target = nb > 1 ? nb - 1 : 0;
  await page.getByRole('button', { name: `צבע ${target + 1}`, exact: true }).click();
  await page.waitForTimeout(1500);
  let r = await page.evaluate(() => ({ man: __tavlit.state.color.manual, pcs: __tavlit.model.pieces.filter(c => c.manual).map(c => c.band) }));
  ok(r.man && r.man.length === 2 && r.pcs.length === 2 && r.pcs.every(b => b === target), 'painted with chosen colour ' + (target + 1));
  await page.screenshot({ path: OUT + 'paint-band.png' });
  // a colour from the general list that is not one of the chosen ones -> an extra colour
  const sw = await page.evaluate(() => { const b = __tavlit.state.color.bands.map(h => h.toLowerCase()); const s = [...document.querySelectorAll('.sec.open .swatches .sw')].reverse().find(e => !b.includes(e.style.background && rgb(e.style.background))); function rgb(c) { const m = c.match(/\d+/g).map(Number); return '#' + m.map(v => v.toString(16).padStart(2, '0')).join(''); } return s ? s.getAttribute('aria-label') : null; });
  await page.locator('.sec.open .swatches').last().getByRole('button', { name: sw, exact: true }).click();
  await page.waitForTimeout(1500);
  r = await page.evaluate(() => ({ man: __tavlit.state.color.manual, colors: __tavlit.model.colors, bands: __tavlit.state.color.bands, pcs: __tavlit.model.pieces.filter(c => c.manual).map(c => c.band) }));
  ok(r.man.length === 2 && r.man.every(o => o.hex) && r.colors.length === r.bands.length + 1 && r.pcs.every(b => b === r.bands.length), 'general-list colour added as extra colour ' + r.colors.slice(-1));
  const auto = before.filter((b, i) => true);
  const others = await page.evaluate(() => __tavlit.model.pieces.filter(c => !c.manual).length);
  ok(others === before.length - 2, 'other pieces untouched');
  await page.getByRole('button', { name: 'סיום בחירה' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + 'paint-hex.png' });
  // saved design carries the overrides
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]);
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(saved.color.manual && saved.color.manual.length === 2, 'design.json keeps the manual colours');
  // print kit: an extra folder for the extra colour, and the design inside it
  const [kd] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), (async () => { await page.click('#kitBtn'); await page.locator('dialog[open] button', { hasText: 'בלי חורים' }).click(); })()]);
  const JSZip = require('jszip'), kz = await JSZip.loadAsync(fs.readFileSync(await kd.path()));
  const dirs = [...new Set(Object.keys(kz.files).filter(f => /^pieces\/colour-/.test(f)).map(f => f.split('/')[1]))];
  ok(dirs.some(d => d.endsWith(r.colors[r.colors.length - 1].slice(1))), 'kit has a folder for the extra colour: ' + dirs.join(', '));
  const kd2 = JSON.parse(await kz.file('design.json').async('string'));
  ok(kd2.color.manual && kd2.color.manual.length === 2, 'kit design.json keeps the manual colours');
  // reset to automatic
  await page.getByRole('button', { name: 'חזרה לצביעה אוטומטית' }).click();
  await page.waitForTimeout(1500);
  r = await page.evaluate(() => ({ man: __tavlit.state.color.manual, bands: __tavlit.model.pieces.map(c => c.band), n: __tavlit.model.colors.length, nb: __tavlit.state.color.bands.length }));
  ok(!r.man && r.n === r.nb && JSON.stringify(r.bands) === JSON.stringify(before), 'back to automatic colours');
  // undo brings the manual colours back
  await page.click('#undoBtn'); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => (__tavlit.state.color.manual || []).length === 2), 'undo restores manual colours');
  ok(!errors.length, 'no page errors ' + errors.join(' | '));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
