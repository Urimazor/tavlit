globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js'); const E=globalThis.WallEngine;
const s=JSON.parse(require('fs').readFileSync(__dirname+'/state.json'));
s.shape.type='octagon'; s.shape.w=400; s.shape.h=320; s.tess.type='sunflower'; s.tess.size=30;
const m=E.build(s);
for (const tl of m.tiles){ const me=E.tileMesh(tl,s.frame);
  const E2=new Map(); for(let i=0;i<me.f.length;i+=3)for(let k=0;k<3;k++){const a=me.f[i+k],b=me.f[i+(k+1)%3];E2.set(a+'_'+b,(E2.get(a+'_'+b)||0)+1);}
  let shown=0; for(const [k,n] of E2){const [a,b]=k.split('_'); if(n!==1||E2.get(b+'_'+a)!==1){ if(shown++<3) console.log(tl.label,k,n,E2.get(b+'_'+a), me.v.slice(a*3,a*3+3).map(x=>x.toFixed(2)), me.v.slice(b*3,b*3+3).map(x=>x.toFixed(2)));}}
  console.log(tl.label,'rings', tl.geom.map(p=>p.length));
}
const tl=m.tiles[0]; console.log(JSON.stringify(tl.geom[0][0].filter(p=>p[1]>140).map(p=>p.map(x=>+x.toFixed(2)))));
console.log('rect', tl.rect, 'outer top', Math.max(...m.outer.map(p=>p[1])));
