// Section 2 "תבנית - דוגמה": gallery, fill toggle, size map, wavy lines, saved patterns; no page errors
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path');
const NM = path.join(__dirname, '..', 'node_modules');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/';
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: Number(process.env.DSF || 1) });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });   // fonts are blocked offline
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.route('**/*', route => {
    const u = route.request().url();
    for (const [re, f] of map) { const m = u.match(re); if (m) return route.fulfill({ path: f(m), contentType: u.endsWith('.js') ? 'application/javascript' : undefined }); }
    if (u.startsWith('file:')) return route.continue();
    return route.abort();
  });
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'tavlit-local.html'));
  await page.waitForFunction(() => window.__tavlit && window.__tavlit.model, null, { timeout: 20000 });
  const title = await page.$eval('section.sec:nth-of-type(2) .sec-title', e => e.textContent);
  console.log('section 2 title:', title);
  if (title !== 'תבנית - דוגמה') errors.push('title ' + title);
  await page.click('section.sec:nth-of-type(2) .sec-head');
  const wait = async () => { await page.waitForTimeout(300); await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 }); await page.waitForTimeout(300); };
  const cards = await page.$$eval('.pat > span', s => s.map(x => x.textContent));
  console.log('patterns:', cards.length, cards.join(', '));
  const shots = process.env.SHOTS ? process.env.SHOTS.split(',') : ['פרחים מרבעי עיגול', 'רשת גלית', 'נקודות: חצי־טון', 'חצאי עיגול'];
  for (const label of cards) {
    await page.click(`.pat:has(span:text-is("${label}"))`);
    await wait();
    const info = await page.evaluate(() => ({ n: __tavlit.model?.pieces.length, motif: __tavlit.model?.motif, warn: [...document.querySelectorAll('#msg .warn')].map(x => x.textContent.slice(0, 50)) }));
    console.log('pattern', label.padEnd(20), JSON.stringify(info));
    if (!info.n) errors.push('no pieces for ' + label);
    if (shots.includes(label)) await page.screenshot({ path: OUT + 'pat-' + shots.indexOf(label) + '.png' });
  }
  // fill toggle and size controls
  await page.click('.chip:text-is("צורות בתאים · מרווחים משתנים")'); await wait();
  console.log('motif on:', await page.evaluate(() => __tavlit.state.tess.fill), await page.evaluate(() => __tavlit.model.motif));
  await page.click('.chip:text-is("ריצוף מלא · מרווח אחיד")'); await wait();
  await page.click('.chip:text-is("מרכז ← שוליים")'); await wait();
  console.log('mod:', JSON.stringify(await page.evaluate(() => __tavlit.state.tess.mod)));
  // save a pattern of my own
  await page.fill('.pat-name', 'הבדיקה שלי'); await page.click('button:text-is("שמור כתבנית")'); await page.waitForTimeout(300);
  console.log('mine:', await page.$$eval('.pat-wrap .pat > span', s => s.map(x => x.textContent)));
  await page.screenshot({ path: OUT + 'pat-panel.png' });
  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
