globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js'); require('../src/presets.js'); const E=globalThis.WallEngine;
for (const p of WallPresets.presets){
 const s=JSON.parse(JSON.stringify(p.state));
 const m=E.build(s);
 const sh=m.pieces.filter(c=>c.scale<1);
 const hist={}; sh.forEach(c=>{const k=c.scale.toFixed(1); hist[k]=(hist[k]||0)+1;});
 console.log(p.key, 'pieces',m.pieces.length,'short',sh.length, JSON.stringify(hist), 'tiles', m.tiles.length, 'knobs', m.knobs.length);
}
