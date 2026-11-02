globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js');
const E = globalThis.WallEngine;
const base = {
 shape:{type:'rect',w:240,h:240,rim:6},
 tess:{type:'voronoi',size:38,relax:3,seed:7,minFrac:0.35},
 surface:{type:'dome',minH:10,depth:24,freq:2,angle:30,seed:3},
 move:{lean:0.9,pull:0,points:[{type:'vortex',x:0,y:0,strength:1,radius:110,fade:160,opening:-0.3,angle:0}]},
 frame:{t:3,rib:2.4,clr:0.15,gap:0.4,joint:9},
 piece:{curve:0.6,twist:30,spiral:40,profile:1,layers:16,smooth:0.6,truncate:0.4,dome:0.5},
 color:{by:'height',bands:['#7c1626','#c0392b','#ee6a3a','#f3ece4'],angle:0,seed:1},
 print:{bedW:250,bedH:210,bedZ:220,margin:5,spacing:3,overhang:45}
};
const variants = [];
for (const st of ['rect','circle','ellipse','hexagon','octagon']) for (const tt of ['hex','square','triangle','radial','voronoi','sunflower']) for (const sf of ['dome','ring','wave','noise']) {
  const s = JSON.parse(JSON.stringify(base)); s.shape.type=st; s.tess.type=tt; s.surface.type=sf;
  if (st!=='rect'){s.shape.w=400;s.shape.h=320;}
  s.tess.size = 30;
  variants.push(s);
}
let fails=0, total=0;
for (const s of variants) {
  const t0=Date.now();
  let m; try { m = E.build(s); } catch(e){ console.log('ERR', s.shape.type, s.tess.type, s.surface.type, e.message); fails++; continue; }
  let bad=0, negvol=0;
  for (const c of m.pieces){ const me=E.pieceMesh(c,s.frame); bad+=E.checkManifold(me); if (E.meshVolume(me)<=0) negvol++; }
  for (const tl of m.tiles){ const me=E.tileMesh(tl,s.frame); bad+=E.checkManifold(me); }
  // tile meshes are multi-shell; check each shell is closed by checking per-shell volume positive
  let tneg=0; for (const tl of m.tiles){ const me=E.tileMesh(tl,s.frame); if (E.meshVolume(me)<=0) tneg++; }
  total++;
  if (bad||negvol||tneg) { fails++; console.log('MESH', s.shape.type, s.tess.type, s.surface.type, {bad,negvol,tneg}); }
  if (s.surface.type==='dome') console.log(s.shape.type.padEnd(8), s.tess.type.padEnd(9), 'pieces',m.pieces.length,'knobs',m.knobs.length,'mounts',m.mounts.length,'blanks',m.blanks.length,'tiles',m.tiles.length, m.tileGrid, 'short', m.pieces.filter(c=>c.scale<1).length, (Date.now()-t0)+'ms', m.warnings.filter(w=>w.kind==='warn').map(w=>w.text).join('|'));
}
console.log('done', total, 'fails', fails);
