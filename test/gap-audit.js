// Visible gaps between neighbouring pieces, seen from the front: for every cell edge shared by two pieces, how far
// each piece's outline (the widest of its sections) stays back from the edge, sampled along the middle of the edge.
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/presets.js'); require('../src/engine.js');
const E = globalThis.WallEngine, PC = globalThis.polygonClipping;
const verbose = process.argv.includes('-v');
function silhouette(c) {
  const rings = [c.base ? c.base.poly : c.body, ...c.layers.map(l => l.poly)];
  const R = rings.map(r => { const q = r.map(p => [p[0], p[1]]); q.push(q[0]); return [q]; });
  try { return PC.union(...R); } catch (e) { return [[R[0][0]]]; }
}
// distance from p along direction u until the silhouette is entered
function rayIn(G, p, u, max) {
  if (G.some(poly => E.inside(poly[0].slice(0, -1), p) && !poly.slice(1).some(h => E.inside(h.slice(0, -1), p)))) return 0;
  let best = Infinity;
  for (const poly of G) for (const ring of poly) for (let k = 0; k < ring.length - 1; k++) {
    const a = ring[k], b = ring[k + 1], ex = b[0] - a[0], ey = b[1] - a[1], den = u[0] * ey - u[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den, w = ((a[0] - p[0]) * u[1] - (a[1] - p[1]) * u[0]) / den;
    if (t >= 0 && w >= 0 && w <= 1) best = Math.min(best, t);
  }
  return best > max ? max : best;
}
function audit(s, label) {
  const m = E.build(s, true), sil = new Map(m.pieces.map(c => [c, silhouette(c)]));
  const byPt = new Map();
  const res = [];
  for (const c of m.pieces) {
    const P = c.poly;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 6) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nIn = [-u[1], u[0]];
      // sample the middle of the edge; at each sample, the piece across the edge from it
      for (const f of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        const q = [p[0] - nIn[0] * 1.5, p[1] - nIn[1] * 1.5];
        const o = m.pieces.find(x => x !== c && E.inside(x.poly, q));
        if (!o || o.id < c.id) continue;
        const g = rayIn(sil.get(c), p, nIn, 20) + rayIn(sil.get(o), p, [-nIn[0], -nIn[1]], 20);
        const key = c.id + '|' + o.id, seam = c.tile !== o.tile;
        if (verbose && g > (+process.env.GAPV || s.frame.gap + 1.2)) console.log('   ', label, c.id, o.id, seam ? 'seam' : 'inner', g.toFixed(2), p.map(v => v.toFixed(1)).join(','));
        if (!byPt.has(key) || byPt.get(key).g < g) byPt.set(key, { g, seam, c, o });
      }
    }
  }
  const all = [...byPt.values()];
  const inner = all.filter(x => !x.seam).map(x => x.g), seam = all.filter(x => x.seam).map(x => x.g);
  const mx = a => a.length ? Math.max(...a) : 0, avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  console.log(label.padEnd(22), 'inner max', mx(inner).toFixed(2), 'avg', avg(inner).toFixed(2), '| seam n', seam.length, 'max', mx(seam).toFixed(2), 'avg', avg(seam).toFixed(2));
  return { inner: mx(inner), seam: mx(seam), m };
}
module.exports = { audit };
if (require.main === module) {
  let fails = 0;
  for (const p of WallPresets.presets) for (const hide of [false, true]) {
    const s = JSON.parse(JSON.stringify(p.state)); s.frame.hideRim = hide;
    const r = audit(s, p.key + (hide ? ' hide' : ''));
    const lim = s.frame.gap + 0.7;
    if (r.seam > lim || r.inner > lim) { fails++; console.log('  FAIL: a gap wider than', lim.toFixed(2)); }
  }
  console.log(fails ? fails + ' failed' : 'all ok'); process.exit(fails ? 1 : 0);
}
