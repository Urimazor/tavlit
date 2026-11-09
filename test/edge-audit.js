// Hidden outer frame (frame.hideRim): is the band round the panel's edge one clean, continuous surface?
// For many designs: (A) vertical rays just outside the outline must hit the band at its own height (nothing pokes
// up out of it, no holes in it away from the gaps between pieces); (B) every corner of an edge piece that lies on the
// panel's edge must sit at the band's top (z0), not lifted above it (that left a notch with spikes beside the gap).
// node test/edge-audit.js [-v]
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/presets.js'); require('../src/engine.js');
const E = globalThis.WallEngine, PR = globalThis.WallPresets.presets;
const verbose = process.argv.includes('-v');
function topHit(tris, x, y) {
  let best = -Infinity;
  for (const t of tris) {
    if (x < t.x0 || x > t.x1 || y < t.y0 || y > t.y1) continue;
    const [a, b, c] = t.p, d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    best = Math.max(best, l1 * a[2] + l2 * b[2] + l3 * c[2]);
  }
  return best;
}
function audit(s) {
  const m = E.build(s, true), out = { spike: 0, hole: 0, lift: 0, n: 0, where: [], open: m.blanks.length };
  const fl = m.pieces.filter(c => c.flare);
  if (!fl.length) return out;
  // (B) corners on the panel's edge stay at the band's top
  for (const c of fl) {
    const o = c.flare.out, n = o.length;
    for (let i = 0; i < n; i++) if (o[i] || o[(i - 1 + n) % n]) {
      const zb = c.base ? c.base.zv[i] : c.z0;
      if (Math.abs(zb - c.z0) > 0.01) { out.lift++; out.where.push(`lift #${c.num} v${i} z${zb.toFixed(2)}`); }
    }
  }
  // (A) rays outside the outline
  const tris = [], sides = [];
  for (const c of fl) {
    const me = E.pieceMesh(c, s.frame), V = me.v, F = me.f;
    for (let k = 0; k < F.length; k += 3) {
      const p = [F[k], F[k + 1], F[k + 2]].map(i => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]);
      tris.push({ p, x0: Math.min(p[0][0], p[1][0], p[2][0]), x1: Math.max(p[0][0], p[1][0], p[2][0]), y0: Math.min(p[0][1], p[1][1], p[2][1]), y1: Math.max(p[0][1], p[1][1], p[2][1]) });
    }
    // ends of each run of the band: rays near them may fall in the gap between two pieces
    const B = c.flare.B, n = B.length;
    for (let i = 0; i < n; i++) if (c.flare.out[i] !== c.flare.out[(i - 1 + n) % n]) sides.push(B[i], c.body[i]);
  }
  const z0 = fl[0].z0, zcs = fl.flatMap(c => c.flare.zc).sort((a, b) => a - b);
  const zE = m.edgeBand ? m.edgeBand.z : zcs[zcs.length >> 1];
  let dmin = m.edgeBand ? m.edgeBand.d : Infinity;
  if (!m.edgeBand) for (const c of fl) c.flare.B.forEach((q, i) => { if (c.flare.out[i]) { const o = m.outer; let dd = Infinity; for (let k = 0; k < o.length; k++) { const a = o[k], b = o[(k + 1) % o.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2)); dd = Math.min(dd, Math.hypot(q[0] - a[0] - ex * t, q[1] - a[1] - ey * t)); } dmin = Math.min(dmin, dd); } });
  const O = m.outer, inside = p => E.inside(O, p);
  const nearSide = p => sides.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2.5);
  for (let k = 0; k < O.length; k++) {
    const a = O[k], b = O[(k + 1) % O.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (inside([mid[0] + nx * 0.1, mid[1] + ny * 0.1])) { nx = -nx; ny = -ny; }
    for (let s0 = 1.5; s0 < L - 1.5; s0 += 0.5) {
      const base = [a[0] + (b[0] - a[0]) * s0 / L, a[1] + (b[1] - a[1]) * s0 / L];
      for (const f of [0.35, 0.7]) {
        // a band only a few tenths wide is nearly upright: judge it by how far it sits off its line (0.1 mm), not by height
        const d = Math.max(0.12, dmin * f), p = [base[0] + nx * d, base[1] + ny * d];
        const z = topHit(tris, p[0], p[1]), want = z0 - (z0 - zE) * d / dmin + 0.1 * (z0 - zE) / dmin;
        out.n++;
        // on a curved outline a piece's outer edge is a chord: it may sit up to 0.2 mm inside the curve
        const zIn = z === -Infinity ? topHit(tris, base[0] + nx * Math.max(0.02, d - 0.2), base[1] + ny * Math.max(0.02, d - 0.2)) : z;
        if (zIn === -Infinity) { if (!nearSide(p)) { out.hole++; if (out.where.length < 12) out.where.push(`hole ${p.map(v => v.toFixed(1))}`); } continue; }
        if (z > want + 0.12) { out.spike++; if (out.where.length < 12) out.where.push(`spike ${p.map(v => v.toFixed(1))} z${z.toFixed(2)} want ${want.toFixed(2)}`); }
      }
    }
  }
  return out;
}
let bad = 0, total = 0;
const tessTypes = [null, 'square', 'hex', 'voronoi', 'triangle'];
const shapes = process.argv.includes('--rect') ? ['rect'] : [null];
for (const p of PR) for (const tt of tessTypes) for (const curve of [0, 0.8]) for (const sh of shapes) {
  const s = JSON.parse(JSON.stringify(p.state)); s.frame.hideRim = true; if (tt) s.tess.type = tt; s.piece.curve = curve; if (sh) s.shape.type = sh;
  if (s.shape.w > 400) { s.shape.w = Math.round(s.shape.w * 0.6); s.shape.h = Math.round(s.shape.h * 0.6); }   // keep it quick
  let r; try { r = audit(s); } catch (e) { console.log(p.key, tt, curve, 'ERR', e.message); bad++; continue; }
  total++;
  const fail = r.spike + r.hole + r.lift;
  if (fail) bad++;
  if (fail || verbose) console.log(p.key.padEnd(7), String(tt || '-').padEnd(8), curve, 'rays', r.n, 'spike', r.spike, 'hole', r.hole, 'lift', r.lift, 'blanks', r.open, verbose || fail ? r.where.slice(0, 4).join(' | ') : '');
}
console.log('edge audit:', total, 'designs,', bad, 'with problems');
process.exitCode = bad ? 1 : 0;
