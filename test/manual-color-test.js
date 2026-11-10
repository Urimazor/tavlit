// manual colours (section 7): overrides land on the right piece, survive renumbering, extra hexes add colours
globalThis.d3 = require('d3-delaunay'); globalThis.polygonClipping = require('polygon-clipping'); globalThis.earcut = require('earcut');
require('../src/engine.js');
const E = globalThis.WallEngine;
const st = {
 shape:{type:'rect',w:240,h:240,rim:6},
 tess:{type:'voronoi',size:38,relax:3,seed:7,minFrac:0.35},
 surface:{type:'dome',minH:10,depth:24,freq:2,angle:30,seed:3},
 move:{lean:0.9,pull:0,points:[]},
 frame:{t:3,rib:2.4,clr:0.07,gap:0.4,joint:9},
 piece:{curve:0.6,twist:30,spiral:40,profile:1,layers:16,smooth:0.6,truncate:0.4,dome:0.5},
 color:{by:'height',bands:['#7c1626','#c0392b','#ee6a3a'],angle:0,seed:1},
 print:{bedW:250,bedH:210,bedZ:220,margin:5,spacing:3,overhang:45}
};
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const a = E.build(st);
ok(a.colors.length === 3, 'auto: colours = bands');
const p1 = a.pieces[3], p2 = a.pieces[7], p3 = a.pieces[11];
const want = (p1.band + 1) % 3;
st.color.manual = [{ x: p1.c[0], y: p1.c[1], b: want }, { x: p2.c[0], y: p2.c[1], hex: '#123456' }, { x: p3.c[0], y: p3.c[1], hex: '#C0392B' }];
const b = E.build(st);
const at = p => b.pieces.find(q => Math.hypot(q.c[0] - p.c[0], q.c[1] - p.c[1]) < 1e-6);
ok(at(p1).band === want && at(p1).manual, 'band override');
ok(b.colors.length === 4 && b.colors[3] === '#123456' && at(p2).band === 3, 'extra hex colour');
ok(at(p3).band === 1, 'hex equal to a chosen colour joins it');
const untouched = b.pieces.filter(q => !q.manual).every(q => q.band === a.pieces.find(r => r.num === q.num).band);
ok(untouched, 'other pieces keep auto colour');
// an override whose band no longer exists (fewer colours) falls back to auto
st.color.bands = ['#7c1626']; st.color.manual = [{ x: p1.c[0], y: p1.c[1], b: 2 }];
ok(E.build(st).pieces.every(q => q.band === 0 && !q.manual), 'stale band ignored');
// a far-away spot matches nothing
st.color.manual = [{ x: 9999, y: 9999, hex: '#123456' }];
ok(E.build(st).colors.length === 1, 'far override ignored');
console.log(fail ? fail + ' failed' : 'manual colours OK');
process.exit(fail ? 1 : 0);
