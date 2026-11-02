const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const NM = path.join(__dirname, '..', 'node_modules');
const OUT = '/tmp/claude-0/-home-claude/1fe8ce36-663b-5ffd-88a5-bcbb8067cca1/scratchpad/';
const map = [
  [/three@0\.160\.0\/(.*)$/, m => path.join(NM, 'three', m[1])],
  [/d3-delaunay@6\.0\.4\/(.*)$/, m => path.join(NM, 'd3-delaunay', m[1])],
  [/polygon-clipping@0\.15\.7\/(.*)$/, m => path.join(NM, 'polygon-clipping', m[1])],
  [/earcut@2\.2\.4\/(.*)$/, m => path.join(NM, 'earcut', m[1])],
  [/jszip\/3\.10\.1\/(.*)$/, m => path.join(NM, 'jszip', 'dist', m[1])],
];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  async function open(w, h, scheme) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, acceptDownloads: true });
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
    await page.waitForFunction(() => window.__tavlit && window.__tavlit.model, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    return page;
  }
  const page = await open(1440, 900, 'light');
  await page.screenshot({ path: OUT + 'shot-desktop.png' });
  // run through presets
  const presets = await page.$$eval('#presetSel option', os => os.map(o => o.value).filter(Boolean));
  for (const k of presets) {
    await page.selectOption('#presetSel', k);
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => ({ n: __tavlit.model?.pieces.length, ms: Math.round(window.__lastBuildMs), msg: document.querySelector('#msg').innerText.slice(0, 160) }));
    console.log('preset', k, info);
    if (k === 'eye' || k === 'sun') await page.screenshot({ path: OUT + `shot-${k}.png` });
  }
  // kit download on the swirl preset
  await page.selectOption('#presetSel', 'swirl'); await page.waitForTimeout(600);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#kitBtn')]);
  await dl.saveAs(OUT + 'ui-kit.zip'); console.log('kit downloaded', dl.suggestedFilename(), fs.statSync(OUT + 'ui-kit.zip').size);
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#fitBtn')]);
  console.log('fit downloaded', dl2.suggestedFilename());
  // map tab
  await page.click('#tabMap'); await page.waitForTimeout(400); await page.screenshot({ path: OUT + 'shot-map.png' }); await page.click('#tab3d');
  // add a point via plan canvas
  await page.click('.tool >> nth=1');
  const box = await (await page.$('#plan')).boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.3);
  await page.waitForTimeout(500);
  console.log('points after add', await page.evaluate(() => __tavlit.state.move.points.length));
  await page.click('#undoBtn'); await page.waitForTimeout(300);
  console.log('points after undo', await page.evaluate(() => __tavlit.state.move.points.length));
  await page.screenshot({ path: OUT + 'shot-panel.png' });
  const dark = await open(400, 860, 'dark');
  await dark.screenshot({ path: OUT + 'shot-phone-dark.png', fullPage: false });
  const sw = await dark.evaluate(() => document.documentElement.scrollWidth);
  console.log('phone scrollWidth', sw);
  console.log('ERRORS', errors.filter(e => !/fonts\.g|ERR_FAILED|net::/.test(e)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
