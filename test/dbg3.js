globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js'); const E=globalThis.WallEngine;
const s=JSON.parse(require('fs').readFileSync(__dirname+'/state.json'));
s.frame.joint=9; s.piece={curve:0.6,twist:30,spiral:40,profile:1,layers:10};
s.shape.type='octagon'; s.shape.w=400; s.shape.h=320; s.tess.type=process.argv[2]||'radial'; s.tess.size=30;
const m=E.build(s);
let pb=0; for(const c of m.pieces) pb+=E.checkManifold(E.pieceMesh(c,s.frame)); console.log('piece bad',pb);
for (const tl of m.tiles){ const me=E.tileMesh(tl,s.frame);
  const E2=new Map(); for(let i=0;i<me.f.length;i+=3)for(let k=0;k<3;k++){const a=me.f[i+k],b=me.f[i+(k+1)%3];E2.set(a+'_'+b,(E2.get(a+'_'+b)||0)+1);}
  let shown=0,bad=0; for(const [k,n] of E2){const [a,b]=k.split('_'); if(n!==1||E2.get(b+'_'+a)!==1){bad++; if(shown++<4) console.log(tl.label,k,n,E2.get(b+'_'+a), me.v.slice(a*3,a*3+3).map(x=>x.toFixed(3)).join(','), me.v.slice(b*3,b*3+3).map(x=>x.toFixed(3)).join(','));}}
  console.log(tl.label,'bad',bad,'polys',tl.geom.length);
}
const tl=m.tiles[0];
tl.geom.forEach((poly,pi)=>poly.forEach((r,ri)=>{ r.forEach((p,i)=>{ if(Math.hypot(p[0]+33,p[1])<0.05) console.log('poly',pi,'ring',ri,'idx',i,'len',r.length, JSON.stringify(r.slice(Math.max(0,i-2),i+3).map(q=>q.map(x=>+x.toFixed(3))))); }); }));
// which cells near (-33,0)
m.cells.forEach(c=>{ c.poly.forEach(p=>{ if(Math.hypot(p[0]+33,p[1])<0.5) console.log('cell',c.id,c.kind,'tile',c.tile, 'seam', c.seam.map(o=>o?o.tile:'-').join(''), JSON.stringify(c.poly.map(q=>q.map(x=>+x.toFixed(2)))), c.opening&&JSON.stringify(c.opening.map(q=>q.map(x=>+x.toFixed(2))))); }); });
