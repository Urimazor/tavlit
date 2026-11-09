// close-ups of the gaps between edge pieces with the outer frame hidden (hideRim)
// node test/gap-shot.js OUTDIR preset [count]   env OVER='{"tess":{...}}' VIEW=out|side|top
const { chromium } = require('playwright'); const path = require('path');
const NM = path.join(__dirname, '..', 'node_modules'); const OUT = process.argv[2] || '.';
const map = [[/three@0\.160\.0\/(.*)$/, m => path.join(NM, 'three', m[1])], [/d3-delaunay@6\.0\.4\/(.*)$/, m => path.join(NM, 'd3-delaunay', m[1])], [/polygon-clipping@0\.15\.7\/(.*)$/, m => path.join(NM, 'polygon-clipping', m[1])], [/earcut@2\.2\.4\/(.*)$/, m => path.join(NM, 'earcut', m[1])], [/jszip\/3\.10\.1\/(.*)$/, m => path.join(NM, 'jszip', 'dist', m[1])]];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  await p.route('**/*', r => { const u = r.request().url(); for (const [re, f] of map) { const m = u.match(re); if (m) return r.fulfill({ path: f(m), contentType: 'application/javascript' }); } return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'tavlit-local.html')); await p.waitForFunction(() => window.__tavlit && __tavlit.model); await p.waitForTimeout(500);
  await p.evaluate(([key, over]) => { const s = JSON.parse(JSON.stringify(WallPresets.presets.find(x => x.key === key).state)); s.frame.hideRim = true; for (const k in over) Object.assign(s[k], over[k]); __tavlit.setState(s); }, [process.argv[3] || 'test', JSON.parse(process.env.OVER || '{}')]);
  await p.waitForTimeout(2500);
  // gaps on the bottom edge: between consecutive flared pieces
  const gaps = await p.evaluate(() => {
    const m = __tavlit.model, h = __tavlit.state.shape.h, yb = -h / 2, xs = [];
    const ed = m.pieces.filter(c => c.flare && c.flare.B.some(q => q[1] < yb - 0.5)).map(c => { const q = c.flare.B.filter(q => q[1] < yb - 0.5).map(q => q[0]); return [Math.min(...q), Math.max(...q), c.num]; }).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ed.length; i++) xs.push([(ed[i - 1][1] + ed[i][0]) / 2, yb, ed[i - 1][2], ed[i][2]]);
    return xs;
  });
  const n = +(process.argv[4] || 3), V = process.env.ORB || '0,1.1';
  await p.evaluate(([z, o]) => { window.__zf = z; window.__orb = o; }, [process.env.ZF || '0.1', V]);
  for (let g = 0; g < Math.min(n, gaps.length); g++) {
    const [x, y, a, bnum] = gaps[Math.floor((g + 0.5) * gaps.length / Math.min(n, gaps.length))];
    await p.evaluate(([x, y, V]) => {
      const nv = __tavlit.nav; nv.view('front', true);
      const P = { x, y, z: 3 };
      nv.zoomAt(+(window.__zf || 0.1), P);
      const [oa, ob] = (window.__orb || '0,1.1').split(',').map(Number); nv.orbit(oa, ob);
    }, [x, y, V]);
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(OUT, `gap-${process.argv[3] || 'test'}-${g}-${V.replace(/[^0-9.-]/g, '_')}.png`), clip: { x: 0, y: 60, width: 760, height: 700 } });
    console.log('gap', g, x.toFixed(1), 'pieces', a, bnum);
  }
  await b.close();
})();
