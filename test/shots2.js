const { chromium } = require('playwright'); const path=require('path');
const NM = path.join(__dirname, '..', 'node_modules'); const OUT='/tmp/claude-0/-home-claude/1fe8ce36-663b-5ffd-88a5-bcbb8067cca1/scratchpad/';
const map = [[/three@0\.160\.0\/(.*)$/, m => path.join(NM,'three',m[1])],[/d3-delaunay@6\.0\.4\/(.*)$/, m => path.join(NM,'d3-delaunay',m[1])],[/polygon-clipping@0\.15\.7\/(.*)$/, m => path.join(NM,'polygon-clipping',m[1])],[/earcut@2\.2\.4\/(.*)$/, m => path.join(NM,'earcut',m[1])],[/jszip\/3\.10\.1\/(.*)$/, m => path.join(NM,'jszip','dist',m[1])]];
(async()=>{ const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']}); const p=await b.newPage({viewport:{width:1300,height:850}});
await p.route('**/*', r=>{const u=r.request().url(); for(const [re,f] of map){const m=u.match(re); if(m) return r.fulfill({path:f(m),contentType:'application/javascript'});} return u.startsWith('file:')?r.continue():r.abort();});
await p.goto('file://'+path.join(__dirname,'..','dist','tavlit-local.html')); await p.waitForFunction(()=>window.__tavlit&&__tavlit.model); await p.waitForTimeout(800);
await p.click('#showPieces'); await p.click('[data-cam=front]'); await p.waitForTimeout(500); await p.screenshot({path:OUT+'frame-only.png'});
await p.click('#showPieces'); await p.click('[data-cam=side]'); await p.waitForTimeout(500); await p.screenshot({path:OUT+'side.png'});
await b.close();})();
