// Clamps between frame tiles, in plan, at every height band: the clamp must not run into the frame or into a
// piece's collar column, its legs must grip a real core on both sides of the seam, and every mesh must be closed.
// Run for every preset, with the outer frame showing and hidden, and with a tight and a loose clamp clearance.
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/presets.js'); require('../src/engine.js');
const E = globalThis.WallEngine, PC = globalThis.polygonClipping;
const ring = p => { const r = p.map(q => [q[0], q[1]]); r.push(r[0]); return [r]; };
const ar = G => G.reduce((s, poly) => s + Math.abs(E.area(poly[0].slice(0, -1))) - poly.slice(1).reduce((h, r) => h + Math.abs(E.area(r.slice(0, -1))), 0), 0);
const rect = (k, hu, n0, n1) => [[-hu, n0], [hu, n0], [hu, n1], [-hu, n1]].map(([s, d]) => [k.m[0] + k.u[0] * s + k.n[0] * d, k.m[1] + k.u[1] * s + k.n[1] * d]);
let fails = 0;
for (const p of WallPresets.presets) for (const hide of [false, true]) for (const cc of [0, 0.25]) {
  const s = JSON.parse(JSON.stringify(p.state)); s.frame.hideRim = hide; s.frame.clampClr = cc;
  const m = E.build(s, true), S = m.clampSpec, label = (p.key + (hide ? ' hide' : '') + ' ' + cc).padEnd(16);
  const slabsOf = tl => tl.slabs || [{ z0: 0, z1: S.t, g: tl.geom }];
  const gi = S.cg - S.jc / 2 + cc, Do = S.cD - cc, hu = S.Lc / 2 - cc, zrc = S.zr + 0.05 + cc;
  let roofHit = 0, legHit = 0, collarHit = 0, weakCore = 0, bad = 0;
  for (const k of m.clamps) {
    const tl = m.tiles.filter(t => k.tiles.includes(t.id));
    const roof = rect(k, hu, -Do, Do);
    // the legs are set for tiles pushed together (seam gap 0): with the tiles at their nominal seam gap, a leg
    // may press up to jointClr/2 into the core (that is the grip); anything more is a collision
    const gl = gi + S.jc / 2, legs = [rect(k, hu, gl, Do), rect(k, hu, -Do, -gl)];
    for (const t of tl) for (const sl of slabsOf(t)) {
      // the overlap of 0.05 mm between stacked shells is not a collision
      if (sl.z1 > zrc + 0.051 && sl.z0 < S.t - 0.1) roofHit += ar(PC.intersection(ring(roof), sl.g));
      if (sl.z0 < zrc && sl.z1 > 0.2) legs.forEach(L => legHit += ar(PC.intersection(ring(L), sl.g)));
    }
    // the core each leg pushes on: 0.3 mm of frame inside the leg, on both sides, all along the clamp
    for (const side of [1, -1]) {
      const band = side > 0 ? rect(k, hu, gi - 0.35 - cc, gi - 0.05 - cc) : rect(k, hu, -gi + 0.05 + cc, -gi + 0.35 + cc);
      const lo = tl.flatMap(t => slabsOf(t).filter(sl => sl.z0 < 0.3).flatMap(sl => sl.g));
      if (ar(PC.intersection(ring(band), lo)) < 0.9 * 0.3 * 2 * hu) weakCore++;
    }
    for (const c of m.pieces) {
      if (Math.hypot(c.c[0] - k.m[0], c.c[1] - k.m[1]) > m.maxExt + 10) continue;
      const col = E.collarColumn(c), out = col ? col.outline : c.collar;
      legs.forEach(L => collarHit += ar(PC.intersection(ring(L), ring(out))));
    }
    const me = E.clampPlaced(k, S); bad += E.checkManifold(me) + (E.meshVolume(me) > 0 ? 0 : 1);
  }
  for (const t of m.tiles) bad += E.checkManifold(E.tileMesh(t, s.frame));
  // (rounding of the tile outlines leaves about 0.001 mm² a clamp)
  const tol = 0.01 + 0.005 * m.clamps.length;
  const ok = roofHit < tol && legHit < tol && collarHit < tol && !weakCore && !bad && m.clamps.length >= (m.tiles.length > 1 ? 1 : 0);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label, 'tiles', m.tiles.length, 'clamps', m.clamps.length, '| roof in frame', roofHit.toFixed(3), 'legs in frame', legHit.toFixed(3), 'legs in collars', collarHit.toFixed(3), 'weak core', weakCore, 'mesh errors', bad);
}
console.log(fails ? fails + ' failed' : 'all ok'); process.exit(fails ? 1 : 0);
