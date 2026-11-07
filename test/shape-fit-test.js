// fit test cut out of the design: a real seam stretch with 2+ clamps, both frame halves and the pieces beside it
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut'); require('../src/engine.js'); require('../src/kit.js'); require('../src/presets.js');
const JSZip = require('jszip'); const fs = require('fs'), os = require('os'), path = require('path');
const { stlOpenEdges } = require('./stl-util.js');
const st0 = JSON.parse(fs.readFileSync(__dirname + '/state.json', 'utf8'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'tavlit-fit-'));
(async () => {
  let fail = 0;
  const cases = [['state.json', st0]];
  const P = (globalThis.WallPresets || {});
  (P.list || P.presets || []).forEach(p => cases.push([p.key, p.state]));
  // a small Voronoi panel that prints as one tile: the seam comes from a split it would get on a smaller bed
  const sw = (P.presets || []).find(p => p.key === 'swirl');
  if (sw) { const s1 = JSON.parse(JSON.stringify(sw.state)); s1.shape.w = 150; s1.shape.h = 150; cases.push(['swirl-small', s1]); }
  for (const [name, st] of cases) {
    let m; try { m = WallEngine.build(st, true); } catch (e) { console.log(name, 'build failed', e.message); continue; }
    const t = Date.now(), r = await WallKit.buildShapeFitTest(m, st, JSZip);
    if (!r) { console.log(name, `${m.tiles.length} tiles, ${m.clamps.length} clamps: no section (single tile)`); fail++; continue; }
    const buf = Buffer.from(await r.blob.arrayBuffer()), z = await JSZip.loadAsync(buf);
    fs.writeFileSync(path.join(OUT, name.replace(/\W+/g, '_') + '.zip'), buf);
    const stls = Object.keys(z.files).filter(f => f.endsWith('.stl'));
    let bad = 0; for (const f of stls) bad += stlOpenEdges(await z.file(f).async('nodebuffer'));
    console.log(name, JSON.stringify(r.section), 'open edges', bad, (Date.now() - t) + 'ms');
    const dj = z.file('design.json'), dOk = !!dj && JSON.stringify(JSON.parse(await dj.async('string'))) === JSON.stringify(st);
    if (!dOk) console.log(name, 'design.json missing or different');
    if (!dOk || bad || r.section.clamps < Math.min(2, m.clamps.length) || r.section.pieces < 2) fail++;
  }
  console.log('out', OUT);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
