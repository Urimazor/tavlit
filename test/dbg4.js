globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js'); const E=globalThis.WallEngine;
const s=JSON.parse(require('fs').readFileSync(__dirname+'/state.json'));
s.frame.joint=9; s.piece={curve:0.6,twist:30,spiral:40,profile:1,layers:10};
s.shape.type=process.argv[2]; s.shape.w=400; s.shape.h=320; if(s.shape.type==='rect'){s.shape.w=240;s.shape.h=240;} s.tess.type=process.argv[3]; s.tess.size=30;
const m=E.build(s);
for (const tl of m.tiles){ const me=E.tileMesh(tl,s.frame);
  const E2=new Map(); for(let i=0;i<me.f.length;i+=3)for(let k=0;k<3;k++){const a=me.f[i+k],b=me.f[i+(k+1)%3];E2.set(a+'_'+b,(E2.get(a+'_'+b)||0)+1);}
  let pts=[]; for(const [k,n] of E2){const [a,b]=k.split('_'); if(n!==1||E2.get(b+'_'+a)!==1){ pts.push(me.v.slice(a*3,a*3+2).map(x=>+x.toFixed(2)).join(','));}}
  if(pts.length) { console.log(tl.label,'bad',pts.length, [...new Set(pts)].slice(0,6).join(' | '));
   const P=[...new Set(pts)][0].split(',').map(Number);
   tl.geom.forEach((poly,pi)=>poly.forEach((r,ri)=>r.forEach((p,i)=>{ if(Math.hypot(p[0]-P[0],p[1]-P[1])<0.6) console.log('  poly',pi,'ring',ri,'len',r.length,'pt',p.map(x=>+x.toFixed(3)).join(',')); })));
  }
}
const T=m.tiles.find(t=>t.label===process.argv[4]); const r=T.geom[0][0]; const P=process.argv[5].split(',').map(Number);
r.forEach((p,i)=>{ if(Math.hypot(p[0]-P[0],p[1]-P[1])<0.05) console.log(i, JSON.stringify(r.slice(i-2,i+3).map(q=>q.map(x=>+x.toFixed(4))))); });
