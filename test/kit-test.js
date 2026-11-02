globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut'); require('../src/engine.js'); require('../src/kit.js');
const JSZip = require('jszip'); const fs=require('fs');
globalThis.Blob = require('buffer').Blob;
const st = JSON.parse(fs.readFileSync(__dirname+'/state.json','utf8'));
(async()=>{
 const m = WallEngine.build(st);
 const r = await WallKit.buildKit(m, st, JSZip, {});
 const buf = Buffer.from(await r.blob.arrayBuffer()); fs.writeFileSync('/tmp/claude-0/-home-claude/1fe8ce36-663b-5ffd-88a5-bcbb8067cca1/scratchpad/kit.zip', buf);
 console.log('zip bytes', buf.length, r.summary.plates.length, 'plates', r.summary.tiles);
})().catch(e=>{console.error(e);process.exit(1)});
(async()=>{ const b = await WallKit.buildFitTest(JSON.parse(require('fs').readFileSync(__dirname+'/state.json','utf8')), require('jszip')); require('fs').writeFileSync('/tmp/claude-0/-home-claude/1fe8ce36-663b-5ffd-88a5-bcbb8067cca1/scratchpad/fit.zip', Buffer.from(await b.arrayBuffer())); console.log('fit ok'); })();
