globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js'); const E=globalThis.WallEngine;
const s=JSON.parse(require('fs').readFileSync(__dirname+'/state.json'));
s.shape={type:'rect',w:240,h:240,rim:6}; s.tess.type='square'; s.tess.size=30;
const m=E.build(s); console.log(m.bounds);
m.tiles.forEach(t=>console.log(t.label,t.bb));
const t=m.tiles[1]; const r=t.geom[0][0]; console.log(r.filter(p=>p[0]<-120.2||p[0]>120.2).slice(0,5));
