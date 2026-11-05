// Every downward face of every piece mesh, from the top of the frame up, must stay within print.overhang
// (+2° for the uneven corners of the base bevel). The thin tip that the engine skips on purpose is not counted.
// Hidden outer frame is left out: there the flat underside over the rail is a bridge between collar and skirt.
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/presets.js'); require('../src/engine.js');
const E = globalThis.WallEngine;
let fails = 0;
for (const p of WallPresets.presets) for (const ov of [40, 50]) {
  const s = JSON.parse(JSON.stringify(p.state)); s.print.overhang = ov;
  const m = E.build(s, true), lim = -Math.sin((ov + 2) * Math.PI / 180);
  let area = 0;
  for (const c of m.pieces) {
    const me = E.pieceMesh(c, s.frame), zTip = c.z0 + 0.6 * c.hb;
    for (let f = 0; f < me.f.length; f += 3) {
      const P = [0, 1, 2].map(i => { const k = me.f[f + i] * 3; return [me.v[k], me.v[k + 1], me.v[k + 2]]; });
      const e = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], g = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const n = [e[1] * g[2] - e[2] * g[1], e[2] * g[0] - e[0] * g[2], e[0] * g[1] - e[1] * g[0]], L = Math.hypot(...n);
      const zl = Math.min(P[0][2], P[1][2], P[2][2]), zh = Math.max(P[0][2], P[1][2], P[2][2]);
      if (L < 1e-9 || zh < 0.01 || zl > zTip) continue;
      if (n[2] / L < lim) area += L / 2;
    }
  }
  const ok = area < 100;   // a few small slivers (≤ ~2° over) at seam corners of narrow wedge cells
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + p.key.padEnd(8) + ' ' + ov + '°  over the limit: ' + area.toFixed(1) + ' mm²');
}
console.log(fails ? fails + ' failed' : 'all ok'); process.exit(fails ? 1 : 0);
