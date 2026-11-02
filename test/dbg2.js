globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js'); const E=globalThis.WallEngine;
const s=JSON.parse(require('fs').readFileSync(__dirname+'/state.json'));
for (const [sh,tt] of [['octagon','sunflower'],['ellipse','hex'],['rect','voronoi']]){
s.shape.type=sh; s.shape.w=400; s.shape.h=320; s.tess.type=tt; s.tess.size=30;
const m=E.build(s);
const sumOpen=m.pieces.reduce((a,c)=>a+E.area(c.opening),0);
const tileA=m.tiles.reduce((a,t)=>a+t.geom.reduce((b,p)=>b+Math.abs(E.area(p[0].slice(0,-1)))-p.slice(1).reduce((x,h)=>x+Math.abs(E.area(h.slice(0,-1))),0),0),0);
console.log(sh,tt,'outer',E.area(m.outer).toFixed(0),'open',sumOpen.toFixed(0),'expected frame',(E.area(m.outer)-sumOpen).toFixed(0),'tiles',tileA.toFixed(0), m.tiles.map(t=>t.geom.length+':'+t.geom.map(p=>p.length).join('/')).join(' '));
// overlapping openings?
let ov=0; for(const a of m.pieces) for(const b of a.nb){ if(a.id<b.id){ const r=polygonClipping.intersection([[a.opening.concat([a.opening[0]])]],[[b.opening.concat([b.opening[0]])]]); if(r.length) ov++; }}
console.log(' overlapping opening pairs', ov);
}
