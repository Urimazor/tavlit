// Fit of the printed parts, in plan: frame tiles must not overlap each other (they meet with the dovetail play),
// and no frame material may sit inside a piece's collar column or closer to it than the press-fit clearance.
// Run for every preset, with the outer frame showing and hidden.
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/presets.js'); require('../src/engine.js');
const E = globalThis.WallEngine, PC = globalThis.polygonClipping;
const ring = p => { const r = p.map(q => [q[0], q[1]]); r.push(r[0]); return [r]; };
const ar = G => G.reduce((s, poly) => s + Math.abs(E.area(poly[0].slice(0, -1))) - poly.slice(1).reduce((h, r) => h + Math.abs(E.area(r.slice(0, -1))), 0), 0);
let fails = 0;
for (const p of WallPresets.presets) for (const hide of [false, true]) {
  const s = JSON.parse(JSON.stringify(p.state)); s.frame.hideRim = hide;
  const m = E.build(s, true), fr = s.frame, label = (p.key + (hide ? ' hide' : '')).padEnd(12);
  let tileOv = 0, inCollar = 0, nearCollar = 0, notched = 0;
  for (let i = 0; i < m.tiles.length; i++) for (let j = i + 1; j < m.tiles.length; j++) tileOv += ar(PC.intersection(m.tiles[i].geom, m.tiles[j].geom));
  // the play between two tiles along a seam: grow one tile by a little less than jointClr, it still must not touch
  for (const c of m.pieces) {
    if (c.mount) continue;
    const col = E.collarColumn(c), out = col ? col.outline : c.collar;
    if (col) notched++;
    const bb = E.bbox(out);
    const grown = E.inset(out, -fr.clr * 0.8, true) || out;
    for (const t of m.tiles) {
      if (t.bb.x0 > bb.x1 + 1 || t.bb.x1 < bb.x0 - 1 || t.bb.y0 > bb.y1 + 1 || t.bb.y1 < bb.y0 - 1) continue;
      try {
        inCollar += ar(PC.intersection(ring(out), t.geom));
        nearCollar += ar(PC.intersection(ring(grown), t.geom));
      } catch (e) { inCollar += 1; console.log('  clipping failed at piece', c.id); }
    }
  }
  const ok = tileOv < 0.01 && inCollar < 0.01 && nearCollar < 0.05;
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label, 'tiles', m.tiles.length, 'knobs', m.knobs.length, 'notched pieces', notched, '| tile overlap', tileOv.toFixed(3), 'frame in collars', inCollar.toFixed(3), 'within clearance', nearCollar.toFixed(3));
}
console.log(fails ? fails + ' failed' : 'all ok'); process.exit(fails ? 1 : 0);
