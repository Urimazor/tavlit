// screenshots of the panel's bottom edge with the outer frame hidden (hideRim): node test/edge-shot.js OUTDIR [tess]
const { chromium } = require('playwright'); const path = require('path');
const NM = path.join(__dirname, '..', 'node_modules'); const OUT = process.argv[2] || '.';
const map = [[/three@0\.160\.0\/(.*)$/, m => path.join(NM, 'three', m[1])], [/d3-delaunay@6\.0\.4\/(.*)$/, m => path.join(NM, 'd3-delaunay', m[1])], [/polygon-clipping@0\.15\.7\/(.*)$/, m => path.join(NM, 'polygon-clipping', m[1])], [/earcut@2\.2\.4\/(.*)$/, m => path.join(NM, 'earcut', m[1])], [/jszip\/3\.10\.1\/(.*)$/, m => path.join(NM, 'jszip', 'dist', m[1])]];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 1300, height: 850 } });
  await p.route('**/*', r => { const u = r.request().url(); for (const [re, f] of map) { const m = u.match(re); if (m) return r.fulfill({ path: f(m), contentType: 'application/javascript' }); } return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'tavlit-local.html')); await p.waitForFunction(() => window.__tavlit && __tavlit.model); await p.waitForTimeout(500);
  if (process.env.OVER) await p.evaluate(o => window.__over = JSON.parse(o), process.env.OVER);
  if (process.env.ZF) await p.evaluate(o => window.__zf = o, process.env.ZF);
  for (const tess of (process.argv[3] || 'square,voronoi,hex').split(',')) {
    await p.evaluate(t => { const pr = (window.WallPresets || {}).presets; const s = JSON.parse(JSON.stringify(t.startsWith('preset:') ? pr.find(x => x.key === t.slice(7)).state : __tavlit.state)); s.frame.hideRim = true; if (!t.startsWith('preset:')) s.tess.type = t; if (window.__over) { for (const k in window.__over) Object.assign(s[k], window.__over[k]); } __tavlit.setState(s); }, tess);
    await p.waitForTimeout(1500);
    await p.evaluate(() => { const n = __tavlit.nav; n.view('front', true); });
    await p.waitForTimeout(300);
    await p.evaluate(() => { const n = __tavlit.nav; n.orbit(0.5, 0.0); n.orbit(0, -1.25); });
    await p.waitForTimeout(300);
    // zoom toward a point on the bottom edge
    await p.evaluate(() => { const n = __tavlit.nav; const r = document.querySelector('#view canvas, canvas').getBoundingClientRect(); const P = n.pick(r.left + 470, r.top + 600); if (P) n.zoomAt(+(window.__zf || 0.5), P); return !!P; }).then(v => console.log(tess, 'zoom', v));
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(OUT, 'edge-' + tess.replace(':', '-') + '.png') });
  }
  await b.close();
})();
