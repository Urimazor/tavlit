// Patterns (section 2): every lattice, size map, wavy lines and shapes-in-cells build, with closed meshes
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js'); require('../src/presets.js');
const E = globalThis.WallEngine, PR = globalThis.WallPresets;
const base = JSON.parse(JSON.stringify(PR.presets[0].state));
base.shape = { type: 'rect', w: 300, h: 240, rim: 6 };
const cases = [];
const L = ['hex', 'square', 'triangle', 'brick', 'basket', 'rhombille', 'trihex', 'octsquare', 'radial', 'voronoi', 'sunflower'];
const MODS = [{ type: 'none' }, { type: 'radial', amount: 0.8 }, { type: 'radial', amount: -0.8 }, { type: 'linear', amount: 0.9, angle: 20 }, { type: 'wave', amount: 0.7, freq: 2, angle: 0, both: true }, { type: 'ripple', amount: 0.6, freq: 2 }];
for (const type of L) for (const mod of MODS) cases.push({ type, size: 30, mod, warp: { amp: 0 }, fill: 'full' });
for (const type of ['square', 'hex', 'brick']) cases.push({ type, size: 26, rot: 30, mod: { type: 'none' }, warp: { amp: 12, len: 160, angle: 0, both: true }, fill: 'full' });
const MOT = ['quarter', 'half', 'leaf', 'tri', 'circle', 'mid', 'shrink'], ARR = ['random', 'same', 'checker', 'rows', 'block', 'blockOut', 'spin'];
MOT.forEach((motif, i) => cases.push({ type: 'square', size: 34, mod: { type: i % 2 ? 'radial' : 'none', amount: 0.6 }, warp: { amp: i === 3 ? 8 : 0, len: 200 }, fill: 'motif', motif, arr: ARR[i % ARR.length], inner: 0.9, vary: i === 4 ? 'center' : 'none', varyAmt: 0.5 }));
for (const type of ['hex', 'voronoi', 'rhombille', 'trihex']) cases.push({ type, size: 32, mod: { type: 'none' }, warp: { amp: 0 }, fill: 'motif', motif: type === 'rhombille' ? 'quarter' : 'circle', arr: 'random', inner: 0.85, vary: 'wave', varyAmt: 0.4 });
let fails = 0;
for (const tc of cases) {
  const st = JSON.parse(JSON.stringify(base));
  st.tess = Object.assign({ relax: 3, seed: 1, twist: 0, center: 8, minFrac: 0.35 }, tc);
  const t0 = Date.now(); let m;
  try { m = E.build(st, true); } catch (e) { console.log('ERR', JSON.stringify(tc), e.message); fails++; continue; }
  let bad = 0, neg = 0;
  for (const c of m.pieces) { const me = E.pieceMesh(c, st.frame); bad += E.checkManifold(me); if (E.meshVolume(me) <= 0) neg++; }
  for (const tl of m.tiles) { const me = E.tileMesh(tl, st.frame); bad += E.checkManifold(me); if (E.meshVolume(me) <= 0) neg++; }
  const ghosts = m.cells.filter(c => c.ghost).length;
  const lbl = [tc.type, tc.fill === 'motif' ? tc.motif + '/' + tc.arr : '', tc.mod.type + (tc.mod.amount ? ':' + tc.mod.amount : ''), tc.warp.amp ? 'warp' : '', tc.rot ? 'rot' + tc.rot : ''].filter(Boolean).join(' ');
  const blanks = m.blanks.length;
  if (bad || neg || m.pieces.length < 8) { fails++; console.log('BAD ', lbl, { pieces: m.pieces.length, bad, neg }); continue; }
  console.log('ok  ', lbl.padEnd(34), 'pieces', String(m.pieces.length).padStart(4), 'blanks', String(blanks).padStart(3), 'ghosts', String(ghosts).padStart(3), 'tiles', m.tiles.length, 'clamps', m.clamps.length, (Date.now() - t0) + 'ms', m.warnings.filter(w => w.kind === 'warn').map(w => w.text.slice(0, 40)).join('|'));
}
console.log('done', cases.length, 'fails', fails);
process.exit(fails ? 1 : 0);
