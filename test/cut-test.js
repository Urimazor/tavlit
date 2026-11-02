// truncation depth beyond 1 and tilted cuts: every piece mesh must stay closed and positive
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js');
const E = globalThis.WallEngine;
const base = {
 shape:{type:'rect',w:240,h:240,rim:6},
 tess:{type:'voronoi',size:34,relax:3,seed:7,minFrac:0.35},
 surface:{type:'dome',minH:10,depth:24,freq:2,angle:30,seed:3},
 move:{lean:0.9,pull:0,points:[{type:'vortex',x:0,y:0,strength:1,radius:110,fade:160,opening:-0.3,angle:0},{type:'magnet',x:60,y:-50,strength:1,radius:40,fade:60,cut:30}]},
 frame:{t:3,rib:2.4,clr:0.05,gap:0.4,joint:9},
 piece:{curve:0.6,twist:30,spiral:40,profile:1,layers:16,smooth:0.6,truncate:0.4,dome:0},
 color:{by:'height',bands:['#7c1626','#c0392b','#ee6a3a','#f3ece4'],angle:0,seed:1},
 print:{bedW:250,bedH:210,bedZ:220,margin:5,spacing:3,overhang:45}
};
let fails = 0, n = 0;
const ref = E.build(JSON.parse(JSON.stringify(base)));
for (const truncate of [0.4, 1, 1.5]) for (const dome of [0, 0.7]) for (const cutBy of ['field', 'radial', 'spiral', 'surface', 'fixed']) for (const cutTilt of [0, 25, 60]) for (const cutVary of [0, 1]) {
  const s = JSON.parse(JSON.stringify(base)); Object.assign(s.piece, { truncate, dome, cutBy, cutTilt, cutVary, cutAngle: 30 });
  if (cutTilt === 0) s.move.points[1].cut = 0;
  let m; try { m = E.build(s); } catch (e) { console.log('ERR', truncate, dome, cutBy, cutTilt, e.stack); fails++; continue; }
  let bad = 0, neg = 0, tilted = 0;
  for (const c of m.pieces) { const me = E.pieceMesh(c, s.frame, { label: true }); bad += E.checkManifold(me); if (E.meshVolume(me) <= 0) neg++; if (Math.abs(c.shape.cutTilt) > 1e-4) tilted++; }
  n++;
  if (bad || neg || (cutTilt > 0 && !tilted) || (cutTilt === 0 && tilted)) { fails++; console.log('FAIL', JSON.stringify({ truncate, dome, cutBy, cutTilt, cutVary, bad, neg, tilted })); }
}
// lower truncation means lower pieces
const h = t => { const s = JSON.parse(JSON.stringify(base)); s.piece.truncate = t; s.move.points[1].cut = 0; const m = E.build(s); return m.pieces.reduce((a, c) => a + c.zApex, 0) / m.pieces.length; };
const h1 = h(1), h15 = h(1.5); console.log('mean height truncate 1:', h1.toFixed(1), ' 1.5:', h15.toFixed(1));
if (!(h15 < h1)) { fails++; console.log('FAIL deeper truncation not lower'); }
// defaults unchanged: no cut params = same apex heights as explicit cutTilt 0
const s0 = JSON.parse(JSON.stringify(base)); s0.move.points[1].cut = 0; const a = E.build(s0);
const s1 = JSON.parse(JSON.stringify(s0)); s1.piece.cutTilt = 0; s1.piece.cutBy = 'radial'; const b = E.build(s1);
if (a.pieces.some((c, i) => Math.abs(c.zApex - b.pieces[i].zApex) > 1e-9)) { fails++; console.log('FAIL defaults changed'); }
console.log('cut-test', n, 'builds, fails', fails);
process.exit(fails ? 1 : 0);
