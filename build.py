import re
r=lambda f: open('src/'+f).read()
h=r('shell.html')
for k,f in [('STYLE','style.css'),('ENGINE','engine.js'),('KIT','kit.js'),('PRESETS','presets.js'),('UI','ui.js')]:
    h=h.replace('/*%s*/'%k, r(f))
open('dist/index.html','w').write(h)
# local standalone version with full document skeleton
open('dist/tavlit-local.html','w').write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>\n'+h+'\n</body></html>')
print(len(h))
