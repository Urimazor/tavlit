globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut'); require('../src/engine.js'); require('../src/kit.js');
const JSZip = require('jszip'); const fs = require('fs'), os = require('os'), path = require('path');
globalThis.Blob = require('buffer').Blob;
const st = JSON.parse(fs.readFileSync(__dirname + '/state.json', 'utf8'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'tavlit-kit-'));
// weld an STL by coordinates and count edges that are not shared by exactly two faces in opposite directions
function stlOpenEdges(buf) {
  const n = buf.readUInt32LE(80), key = new Map(), E = new Map(); let id = 0;
  const vid = (x, y, z) => { const k = x.toFixed(4) + ',' + y.toFixed(4) + ',' + z.toFixed(4); if (!key.has(k)) key.set(k, id++); return key.get(k); };
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12, v = [0, 1, 2].map(j => vid(buf.readFloatLE(o + j * 12), buf.readFloatLE(o + j * 12 + 4), buf.readFloatLE(o + j * 12 + 8)));
    for (let k = 0; k < 3; k++) { const e = v[k] + '_' + v[(k + 1) % 3]; E.set(e, (E.get(e) || 0) + 1); }
  }
  let bad = 0; for (const [e, c] of E) { const [a, b] = e.split('_'); if (c !== 1 || E.get(b + '_' + a) !== 1) bad++; }
  return bad;
}
(async () => {
  const m = WallEngine.build(st);
  const r = await WallKit.buildKit(m, st, JSZip, {});
  const buf = Buffer.from(await r.blob.arrayBuffer()); fs.writeFileSync(path.join(OUT, 'kit.zip'), buf);
  console.log('zip bytes', buf.length, r.summary.plates.length, 'plates', r.summary.tiles);
  const b = await WallKit.buildFitTest(st, JSZip);
  const fz = await JSZip.loadAsync(Buffer.from(await b.arrayBuffer()));
  const stl = await fz.file('fit-test.stl').async('nodebuffer');
  const bad = stlOpenEdges(stl);
  console.log('fit test', stl.length, 'bytes, open edges', bad);
  if (bad) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
