/* Print-kit builder: turns a built model into a ZIP of 3MF/STL plates + assembly maps. */
(function (root) {
  'use strict';
  const E = root.WallEngine;

  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }
  function polyPath(p, fy) { return 'M' + p.map(q => fmt(q[0]) + ' ' + fmt(fy(q[1]))).join('L') + 'Z'; }
  function textColor(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1b1f1d' : '#ffffff';
  }

  // full-size assembly map (1:1 in mm) — returns svg string; window = optional [x0,y0,w,h] in panel coords (y up)
  function assemblySVG(model, st, win, pageLabel) {
    const ob = model.bounds, pad = 8;
    const fy = y => -y;
    const vb = win ? [win[0], -(win[1] + win[3]), win[2], win[3]] : [ob.x0 - pad, -ob.y1 - pad - 14, ob.w + 2 * pad, ob.h + 2 * pad + 14];
    const fs = Math.max(3, Math.min(9, Math.sqrt(model.nominal) * 0.28));
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(vb[2])}mm" height="${fmt(vb[3])}mm" viewBox="${vb.map(fmt).join(' ')}" font-family="Arial, sans-serif">`);
    out.push(`<rect x="${fmt(vb[0])}" y="${fmt(vb[1])}" width="${fmt(vb[2])}" height="${fmt(vb[3])}" fill="#fff"/>`);
    out.push(`<path d="${polyPath(model.outer, fy)}" fill="#e9e9e6" stroke="#333" stroke-width="0.4"/>`);
    model.cells.forEach(c => {
      if (c.kind === 'blank') { out.push(`<path d="${polyPath(c.poly, fy)}" fill="#cfcfca" stroke="#999" stroke-width="0.2"/>`); return; }
      const col = st.color.bands[c.band];
      out.push(`<path d="${polyPath(c.opening, fy)}" fill="${col}" fill-opacity="0.85" stroke="#222" stroke-width="0.25"/>`);
      const ax = c.apex[0] - c.c[0], ay = c.apex[1] - c.c[1], L = Math.hypot(ax, ay);
      if (L > 1.5) {
        const k = Math.min(1, (Math.sqrt(model.nominal) * 0.32) / L);
        out.push(`<line x1="${fmt(c.c[0])}" y1="${fmt(fy(c.c[1]))}" x2="${fmt(c.c[0] + ax * k)}" y2="${fmt(fy(c.c[1] + ay * k))}" stroke="${textColor(col)}" stroke-opacity="0.45" stroke-width="0.5"/>`);
      }
      out.push(`<text x="${fmt(c.c[0])}" y="${fmt(fy(c.c[1]) + fs * 0.35)}" font-size="${fmt(fs)}" text-anchor="middle" font-weight="700" fill="${textColor(col)}">${c.num}</text>`);
    });
    // frame tile outlines (tiles follow whole cells and are held by clamps)
    if (model.tiles.length > 1) model.tiles.forEach(tl => {
      tl.geom.forEach(poly => out.push(`<path d="${polyPath(poly[0].slice(0, -1), fy)}" fill="none" stroke="#0a58ca" stroke-width="0.7" stroke-dasharray="3 1.6"/>`));
      const cx = (tl.bb.x0 + tl.bb.x1) / 2, cy = (tl.bb.y0 + tl.bb.y1) / 2;
      out.push(`<text x="${fmt(cx)}" y="${fmt(fy(cy))}" font-size="${fmt(fs * 3)}" text-anchor="middle" fill="#0a58ca" fill-opacity="0.2" font-weight="700">${tl.label}</text>`);
    });
    (model.mounts || []).forEach(m => {
      const r = ((st.frame.hang && st.frame.hang.head) || 8.5) / 2, P = q => `${fmt(q[0])} ${fmt(fy(q[1]))}`;
      out.push(`<circle cx="${fmt(m.E[0])}" cy="${fmt(fy(m.E[1]))}" r="${fmt(r)}" fill="none" stroke="#c0392b" stroke-width="0.5" stroke-dasharray="1.2 0.8"/>`);
      out.push(`<path d="M${P(m.F1)}L${P(m.E)}L${P(m.F2)}" fill="none" stroke="#c0392b" stroke-width="0.5"/>`);
      [m.F1, m.F2].forEach(q => out.push(`<path d="M${fmt(q[0] - 1.6)} ${fmt(fy(q[1]))}h3.2M${fmt(q[0])} ${fmt(fy(q[1]) - 1.6)}v3.2" stroke="#c0392b" stroke-width="0.6"/>`));
    });
    if (!win) out.push(`<text x="${fmt(ob.x0)}" y="${fmt(-ob.y1 - 6)}" font-size="5" fill="#333">${E.esc(st.name || 'panel')} — ${model.pieces.length} pieces — 1:1 (mm)</text>`);
    if (pageLabel) out.push(`<text x="${fmt(vb[0] + 3)}" y="${fmt(vb[1] + 6)}" font-size="4" fill="#0a58ca">${pageLabel}</text>`);
    if (win) { // crop marks
      out.push(`<rect x="${fmt(vb[0] + 0.5)}" y="${fmt(vb[1] + 0.5)}" width="${fmt(vb[2] - 1)}" height="${fmt(vb[3] - 1)}" fill="none" stroke="#999" stroke-width="0.2" stroke-dasharray="2 2"/>`);
    }
    out.push('</svg>');
    return out.join('\n');
  }

  function plateSVG(plate, pr, title, colorHex) {
    const W = pr.bedW, H = pr.bedH, fy = y => H - y;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W + 20}mm" height="${H + 30}mm" viewBox="-10 -16 ${W + 20} ${H + 30}" font-family="Arial, sans-serif">`];
    out.push(`<rect x="-10" y="-16" width="${W + 20}" height="${H + 30}" fill="#fff"/>`);
    out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f4f4f2" stroke="#333" stroke-width="0.6"/>`);
    out.push(`<text x="0" y="-6" font-size="6" fill="#222">${E.esc(title)}</text>`);
    out.push(`<text x="${W / 2}" y="${H + 9}" font-size="4.5" text-anchor="middle" fill="#666">front of printer</text>`);
    plate.items.forEach(it => {
      const fp = it.footprint; // polygon in bed coords
      out.push(`<path d="${polyPath(fp, fy)}" fill="${colorHex}" fill-opacity="0.55" stroke="#222" stroke-width="0.3"/>`);
      const c = E.centroid(fp);
      const fs = Math.max(3.5, Math.min(9, Math.sqrt(Math.abs(E.area(fp))) * 0.3));
      out.push(`<text x="${fmt(c[0])}" y="${fmt(fy(c[1]) + fs * 0.35)}" font-size="${fmt(fs)}" text-anchor="middle" font-weight="700" fill="#111">${E.esc(it.label)}</text>`);
    });
    out.push('</svg>');
    return out.join('\n');
  }

  function zip3mf(JSZip, objects, colorHex) {
    const z = new JSZip();
    z.file('[Content_Types].xml', E.CONTENT_TYPES);
    z.folder('_rels').file('.rels', E.RELS);
    z.folder('3D').file('3dmodel.model', E.model3mf(objects, colorHex));
    return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  async function buildKit(model, st, JSZip, opts = {}) {
    const pr = st.print, fr = st.frame;
    const zip = new JSZip();
    const safe = s => String(s).replace(/[^\w֐-׿-]+/g, '_').slice(0, 40) || 'panel';
    const summary = { plates: [], tiles: [] };
    const names = opts.colorNames || [];

    // pieces by colour band
    for (let b = 0; b < st.color.bands.length; b++) {
      const group = model.pieces.filter(c => c.band === b);
      if (!group.length) continue;
      const hex = st.color.bands[b];
      const items = group.map(c => {
        const m = E.pieceMesh(c, fr, { label: st.print.engrave !== false }); // number recessed in the underside
        return { w: c.fp.w, h: c.fp.h, ref: { c, m } };
      });
      const plates = E.packPlates(items, pr);
      const folder = zip.folder(`pieces/colour-${b + 1}-${hex.slice(1)}`);
      for (let p = 0; p < plates.length; p++) {
        const objs = [], merged = new E.Mesh();
        plates[p].items.forEach(it => {
          const lm = E.localize(it.ref.m, it.rot);
          objs.push({ name: `P${it.ref.c.num}`, mesh: lm, x: it.x, y: it.y });
          merged.append(lm, it.x, it.y, 0);
          // footprint polygon in bed coords (body outline + apex hull, approximated by body + apex bbox)
          const src = it.ref.c.body.concat([it.ref.c.apex]); (it.ref.c.layers || []).forEach(l => src.push(...l.poly));
          const rot = it.rot ? src.map(q => [-q[1], q[0]]) : src;
          const bb = E.bbox(rot);
          it.footprint = hull(rot).map(q => [q[0] - bb.x0 + it.x, q[1] - bb.y0 + it.y]);
          it.label = String(it.ref.c.num);
        });
        const nm = `plate-${String(p + 1).padStart(2, '0')}`;
        folder.file(nm + '.3mf', await zip3mf(JSZip, objs, hex));
        folder.file(nm + '.stl', E.stlBinary(merged, nm));
        folder.file(nm + '-map.svg', plateSVG(plates[p], pr, `Colour ${b + 1} (${hex}) — plate ${p + 1}/${plates.length} — ${plates[p].items.length} pieces`, hex));
        summary.plates.push({ band: b, hex, n: plates[p].items.length, file: `${folder.root}${nm}` });
      }
    }
    // frame tiles
    const ff = zip.folder('frame');
    const uw = pr.bedW - 2 * pr.margin, uh = pr.bedH - 2 * pr.margin;
    for (const tl of model.tiles) {
      const m = E.tileMesh(tl, fr);
      // turn the tile 90° when it only fits the bed that way
      const rot = !!tl.bb && (tl.bb.w > uw + 0.31 || tl.bb.h > uh + 0.31) && tl.bb.h <= uw + 0.31 && tl.bb.w <= uh + 0.31;
      const lm = E.localize(m, rot);
      const bb = E.bbox(chunk(lm.v));
      const x = (pr.bedW - bb.w) / 2, y = (pr.bedH - bb.h) / 2;
      ff.file(`frame-${tl.label}.3mf`, await zip3mf(JSZip, [{ name: `frame ${tl.label}`, mesh: lm, x, y }], fr.color || '#8a8d91'));
      ff.file(`frame-${tl.label}.stl`, E.stlBinary(lm, 'frame ' + tl.label));
      summary.tiles.push(tl.label);
    }
    // clamps between frame tiles: all on their own plate(s), standing on their U-shaped end, plus a few spares
    const nCl = (model.clamps || []).length;
    if (nCl) {
      const S = model.clampSpec, spare = Math.max(2, Math.ceil(nCl * 0.1)), m = E.localize(clampPrint(S));
      const bb = E.bbox(chunk(m.v));
      const plates = E.packPlates(Array.from({ length: nCl + spare }, (_, i) => ({ w: bb.w + 1, h: bb.h + 1, ref: i })), Object.assign({}, pr, { spacing: Math.max(pr.spacing, 3) }));
      for (let p = 0; p < plates.length; p++) {
        const objs = [], merged = new E.Mesh();
        plates[p].items.forEach(it => { objs.push({ name: `clamp ${it.ref + 1}`, mesh: m, x: it.x, y: it.y }); merged.append(m, it.x, it.y, 0); });
        const nm = `clamps${plates.length > 1 ? '-' + (p + 1) : ''}`;
        ff.file(nm + '.3mf', await zip3mf(JSZip, objs, fr.color || '#8a8d91'));
        ff.file(nm + '.stl', E.stlBinary(merged, nm));
      }
      summary.clamps = { n: nCl, spare, plates: plates.length };
    }
    // assembly maps
    const am = zip.folder('assembly-map');
    am.file('map-full-1to1.svg', assemblySVG(model, st));
    const ob = model.bounds, pw = 190, ph = 277; // A4 printable area
    const nx = Math.ceil((ob.w + 10) / pw), ny = Math.ceil((ob.h + 10) / ph);
    if (nx * ny > 1) {
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const win = [ob.x0 - 5 + i * pw, ob.y1 + 5 - (j + 1) * ph, pw, ph];
        am.file(`a4-row${j + 1}-col${i + 1}.svg`, assemblySVG(model, st, win, `A4 ${j + 1}/${ny} - ${i + 1}/${nx}`));
      }
    }
    zip.file('design.json', JSON.stringify(st, null, 2));
    zip.file('README.txt', readme(model, st, summary, nx * ny));
    return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), summary };
  }

  function clampPrint(S, cc, marks) { return E.clampMesh(S, cc, marks); }
  function chunk(v) { const o = []; for (let i = 0; i < v.length; i += 3) o.push([v[i], v[i + 1]]); return o; }
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  function readme(model, st, sm, pages) {
    const L = [];
    L.push(`ערכת הדפסה: ${st.name || 'פאנל'}`);
    L.push(`גודל: ${st.shape.w}×${st.shape.h} מ"מ · ${model.pieces.length} חלקים · ${st.color.bands.length} צבעים · ${model.tiles.length} אריחי מסגרת`);
    L.push('');
    L.push('סדר עבודה מומלץ (Prusa MK4, PLA):');
    L.push('1. קודם כול הדפס חלק אחד ואריח מסגרת אחד ובדוק שהחלק ננעץ בחוזקה. אם רופף, הקטן את "מרווח התאמה"; אם לא נכנס, הגדל.');
    L.push('2. תיקיית frame: כל אריח הוא פלטה אחת. פתח את קובץ ה-3MF ב-PrusaSlicer. גובה שכבה 0.2, 2 דפנות, מילוי 15%.');
    L.push('3. תיקיית pieces: תיקייה לכל צבע, ובה פלטות מוכנות. החלף גליל לפני כל צבע. הגדרות: 0.2 מ"מ, 2 דפנות, מילוי 10%-15%, בלי תמיכות.');
    L.push('   לכל פלטה יש קובץ plate-XX-map.svg שמראה איזה מספר נמצא איפה על המשטח. ' + (st.print.engrave !== false ? 'בנוסף, המספר של כל חלק שקוע בתחתית שלו (0.4 מ"מ, הפוך כמו בראי כשמסתכלים מלמעלה, וקריא כשהופכים את החלק). חלקים קטנים מאוד נשארים בלי מספר.' : 'מומלץ להוריד חלקים מהמשטח לפי המפה ולסמן מספר בעיפרון בתחתית.'));
    L.push('4. תיקיית assembly-map: מפת הרכבה בקנה מידה 1:1.' + (pages > 1 ? ` יש גם ${pages} דפי A4 להדפסה בגודל אמיתי (100%, בלי "התאם לעמוד"), להדבקה זה לצד זה.` : ''));
    if (sm.clamps) {
      L.push(`5. חבקים: בתיקיית frame יש ${sm.clamps.n} חבקים ועוד ${sm.clamps.spare} רזרביים (קבצי clamps). הם מודפסים כשהם עומדים על הצד בצורת ח, בלי תמיכות. אם קשה להם להיצמד למשטח, הוסף שוליים (brim).`);
      L.push('   הנח את האריחים צמודים על משטח שטוח, פנים למטה (הגב כלפי מעלה) או פנים למעלה, ובכל מקום שבו יש בצלע מגרעת קטנה מלמעלה ושתי מגרעות בצדדים, לחץ חבק מלמעלה עד שהגג שלו יושב בגובה המסגרת. הרגליים לוחצות את שני האריחים זה אל זה.');
      L.push('   אם החבק לא נכנס, הגדל את "מרווח בחבק"; אם הוא רופף, הקטן אותו (רק החבקים משתנים, אין צורך להדפיס את האריחים שוב). טיפת דבק CA בחבק מקבעת אותו לתמיד, אבל לא חובה.');
      L.push('   אחר כך הנח את המפה מתחת ונעץ חלקים לפי המספרים. החלקים שליד חבק מקבלים מגרעת קטנה בצוואר שמתאימה לרגל החבק.');
    } else L.push('5. הנח את המפה מתחת למסגרת ונעץ חלקים לפי המספרים.');
    if ((model.mounts || []).length) {
      L.push('6. תלייה: בארבע הפינות יש מאחור חור מנעול בצורת L (באדום במפה). ראש הבורג נכנס בעיגול, והפאנל מחליק למטה כך שהבורג נתפס בקצה הזרוע.');
      L.push('   כל פינה עליונה עובדת בשני הכיוונים: הזרוע האנכית לתלייה לאורך, והזרוע לכיוון הצד לתלייה לרוחב. תמיד משתמשים בשני הברגים העליונים.');
      L.push('   מיקום הברגים בקיר: הצלבים האדומים בקצות הזרועות שפונות למעלה. השאר את הבורג בולט מהקיר ' + (model.hangLevels.lip + st.frame.hang.headH).toFixed(1) + ' מ"מ עד קצה הראש (' + model.hangLevels.lip.toFixed(1) + ' מ"מ של גוף הבורג ועוד ראש בעובי ' + st.frame.hang.headH + ' מ"מ).');
      L.push('   המסגרת נשארת בעובי רגיל והחלקים נראים בדיוק כמו בלי חורי תלייה. מתחת לחלק שמעל החור התא במסגרת מלא, ועליו טבעת נמוכה; בתחתית החלק יש חלל שנכנס על הטבעת וממשיך כמקום לראש הבורג. אריח עם חור תלייה בנוי מכמה שכבות גוף חופפות; PrusaSlicer מאחד אותן בפריסה.');
    }
    L.push('');
    L.push('קבצים: ' + sm.plates.length + ' פלטות חלקים, ' + sm.tiles.length + ' אריחי מסגרת' + (sm.clamps ? ', ' + sm.clamps.plates + ' פלטות חבקים' : '') + '.');
    L.push('design.json: ההגדרות של העיצוב. אפשר לטעון אותו בחזרה באפליקציה.');
    return L.join('\r\n');
  }

  // small strip to dial in press-fit clearance: 5 square cells, 5 pieces with growing clearance.
  // The taller the piece, the looser it is, so they can be told apart without labels.
  async function buildFitTest(st, JSZip) {
    const fr = st.frame, pr = st.print, half = fr.rib / 2;
    const cs = 24, n = 5, rim = 5;
    const clrs = [0.03, 0.05, 0.07, 0.10, 0.15]; // around the 0.07 mm default (0.05 fit best on the first MK4 test)
    const W = n * cs + 2 * rim, H = cs + 2 * rim;
    const cells = [];
    for (let i = 0; i < n; i++) {
      const x0 = -W / 2 + rim + i * cs, y0 = -cs / 2;
      cells.push([[x0, y0], [x0 + cs, y0], [x0 + cs, y0 + cs], [x0, y0 + cs]]);
    }
    const ring = p => p.concat([p[0]]);
    const PCl = root.polygonClipping;
    const S = E.clampSpec(fr), jc = S.jc;
    // the seam between cell 3 and 4 is held by a clamp, exactly like the real frame: the normal rib, widened into a
    // short core under the clamp, with slots for its legs; the two pieces beside it get a notch for the legs
    const xs = -W / 2 + rim + 3 * cs;
    const left = [[-W / 2, -H / 2], [xs - jc / 2, -H / 2], [xs - jc / 2, H / 2], [-W / 2, H / 2]], right = [[xs + jc / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [xs + jc / 2, H / 2]];
    const parts = cells.map((c, i) => {
      const X = { poly: c, opening: E.inset(c, half), collar: E.inset(E.inset(c, half), clrs[i]), body: E.inset(c, fr.gap / 2) };
      // cell 3's right edge (index 1) and cell 4's left edge (index 3)
      const nt = i === 2 ? { o: c[1], uk: [0, 1], nIn: [-1, 0] } : i === 3 ? { o: c[3], uk: [0, -1], nIn: [1, 0] } : null;
      if (!nt) return X;
      Object.assign(nt, { s1: cs / 2 - S.Lc / 2, s2: cs / 2 + S.Lc / 2, D: S.cg, Dc: S.cD });
      const r = E.notchCut(X, [nt], clrs[i]);
      return r ? Object.assign(X, { opening: r.opening, collar: r.collar, body: r.body, notch: r.notch }) : X;
    });
    const rectX = (x0, x1, hy) => [[x0, -hy], [x1, -hy], [x1, hy], [x0, hy]];
    const holes = parts.map(X => [ring(X.opening)]);
    const slots = [[ring(rectX(xs + S.cg, xs + S.cD + 0.5, S.Lc / 2))], [ring(rectX(xs - S.cD - 0.5, xs - S.cg, S.Lc / 2))]];
    const R = [ring(rectX(xs - S.cD, xs + S.cD, S.Lc / 2 + 0.05))];
    const half2 = q => { const g = PCl.difference([ring(q)], ...holes, ...slots); return { geom: g, slabs: [{ z0: 0, z1: S.zr, g }, { z0: S.zr, z1: fr.t, g: PCl.difference(g, R) }] }; };
    const mA = E.localize(E.tileMesh(half2(left), fr)), mB = E.localize(E.tileMesh(half2(right), fr));
    const objs = [{ name: 'fit-frame-A', mesh: mA, x: 20, y: pr.bedH - H - 20 }, { name: 'fit-frame-B', mesh: mB, x: 20 + 3 * cs + rim + 15, y: pr.bedH - H - 20 }];
    const merged = new E.Mesh().append(mA, objs[0].x, objs[0].y, 0).append(mB, objs[1].x, objs[1].y, 0);
    // five clamps, from tight to loose; the grooves on the roof count them (1 = tightest)
    const cls = [0, 0.05, 0.10, 0.15, 0.20], clLines = [];
    cls.forEach((cc, i) => {
      const m = E.localize(E.clampMesh(S, cc, i + 1)), x = 20 + i * 14, y = pr.bedH - H - 45;
      objs.push({ name: `fit-clamp-${cc.toFixed(2)}mm`, mesh: m, x, y }); merged.append(m, x, y, 0);
      clLines.push(`חבק עם ${i + 1} חריצים בגג: מרווח ${cc.toFixed(2)} מ"מ לכל צד`);
    });
    const lines = [];
    cells.forEach((c, i) => {
      const clr = clrs[i];
      const chamfer = Math.max(0.6, half + clr - fr.gap / 2);
      const pc = { collar: parts[i].collar, body: parts[i].body, notch: parts[i].notch, apex: E.centroid(c), z0: fr.t + chamfer, zApex: fr.t + chamfer + 6 + i * 3, layers: [] };
      const m = E.localize(E.pieceMesh(pc, fr));
      const x = (pr.bedW - W) / 2 + i * (cs + 6), y = 20;
      objs.push({ name: `fit-${clr.toFixed(2)}mm`, mesh: m, x, y });
      merged.append(m, x, y, 0);
      lines.push(`חלק ${i + 1} (גובה ${(pc.zApex).toFixed(0)} מ"מ): מרווח ${clr.toFixed(2)} מ"מ לכל צד`);
    });
    const zip = new JSZip();
    zip.file('fit-test.3mf', await zip3mf(JSZip, objs, fr.color || '#85898c'));
    zip.file('fit-test.stl', E.stlBinary(merged, 'fit test'));
    zip.file('README.txt', ['בדיקת התאמה ל-MK4', '', 'הדפס את הקובץ (פלטה אחת, בלי תמיכות), ונסה לנעוץ כל חלק בתא שלו.', 'בחר את החלק הראשון שנכנס ביד בלחיצה ונשאר תפוס כשהופכים את המסגרת, והזן את המרווח שלו באפליקציה תחת "מרווח התאמה".', 'המסגרת מודפסת בשני חלקים, ויש איתה חמישה חבקים כמו אלה שמחזיקים את האריחים האמיתיים. הצמד את שני החלקים ולחץ חבק לתוך המגרעת שבחיבור, מלמעלה.', 'בחר את החבק הראשון שנכנס בלחיצת אצבע, יושב בגובה המסגרת ומחזיק את שני החלקים צמודים, והזן את המרווח שלו באפליקציה תחת "מרווח בחבק". את החבקים סופרים לפי החריצים הקטנים בגג.', '', ...lines, '', ...clLines].join('\r\n'));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  // ---------- fit test cut out of the design itself ----------
  // A piece of the real frame: the stretch of one tile seam that holds a few clamps (2-3), with every cell that
  // touches it on both sides. The two halves keep the real seam (a zigzag on Voronoi, a straight line on a grid),
  // the real openings, the clamp recesses and leg slots; the pieces are the real cells' collars (with their notch
  // for the clamp's leg), cut short and each made with a different press-fit clearance.
  // Returns null when the design has no seam with a clamp (a single tile).
  function pickSection(model, st) {
    const pr = st.print, uw = pr.bedW - 2 * pr.margin, uh = pr.bedH - 2 * pr.margin, half = st.frame.rib / 2;
    const cl = model.clamps || [];
    if (!cl.length) return null;
    const byPair = new Map();
    cl.forEach(k => { const key = k.tiles.slice().sort((a, b) => a - b).join('|'); if (!byPair.has(key)) byPair.set(key, []); byPair.get(key).push(k); });
    const fits = (w, h) => (w <= uw && h <= uh) || (h <= uw && w <= uh);
    let best = null;
    for (const [key, list] of byPair) {
      const [A, B] = key.split('|').map(Number);
      // order the clamps along the seam: project on the line through the two that lie furthest apart
      let ax = [1, 0];
      if (list.length > 1) {
        let d0 = -1;
        for (const p of list) for (const q of list) { const d = Math.hypot(q.m[0] - p.m[0], q.m[1] - p.m[1]); if (d > d0) { d0 = d; ax = [(q.m[0] - p.m[0]) / d, (q.m[1] - p.m[1]) / d]; } }
      } else ax = list[0].u;
      const pj = q => q[0] * ax[0] + q[1] * ax[1];
      const ord = list.slice().sort((p, q) => pj(p.m) - pj(q.m));
      for (let k = Math.min(3, ord.length); k >= 1; k--) {
        for (let i = 0; i + k <= ord.length; i++) {
          const win = ord.slice(i, i + k), t0 = pj(win[0].m) - 2, t1 = pj(win[k - 1].m) + 2;
          // every cell of the two tiles with a seam edge (to the other tile) in this stretch
          const cells = model.cells.filter(c => (c.tile === A || c.tile === B) && c.poly && c.seam && c.seam.some((o, j) => {
            if (!o || o.tile === c.tile || (o.tile !== A && o.tile !== B)) return false;
            const a = c.poly[j], b = c.poly[(j + 1) % c.poly.length], ta = pj(a), tb = pj(b);
            return Math.max(ta, tb) >= t0 && Math.min(ta, tb) <= t1;
          }));
          if (!cells.some(c => c.tile === A) || !cells.some(c => c.tile === B) || cells.some(c => c.mount)) continue;
          const side = id => { const pts = []; cells.filter(c => c.tile === id).forEach(c => (E.inset(c.tpoly, -half, true) || c.tpoly).forEach(q => pts.push(q))); return E.bbox(pts); };
          const bA = side(A), bB = side(B);
          if (!fits(bA.w + 1, bA.h + 1) || !fits(bB.w + 1, bB.h + 1)) continue;
          const area = bA.w * bA.h + bB.w * bB.h;
          // most clamps first, then the most compact stretch
          const score = k * 1e9 - area;
          if (!best || score > best.score) best = { score, A, B, clamps: win, cells };
        }
        if (best && best.clamps.length === k) break;
      }
    }
    return best;
  }

  // the part of tile `tl` inside `clip` (a multipolygon), with its slabs; loose slivers dropped
  function cutTile(tl, clip) {
    const PC = root.polygonClipping, ar = poly => Math.abs(E.area(poly[0].slice(0, -1)));
    const keepBig = g => { const a = g.map(ar), big = Math.max(0, ...a); return g.filter((poly, i) => a[i] > Math.max(1, big * 0.05)); };
    const geom = keepBig(PC.intersection(tl.geom, clip));
    if (!geom.length) return null;
    const slabs = tl.slabs ? tl.slabs.map(sl => ({ z0: sl.z0, z1: sl.z1, g: PC.intersection(sl.g, geom).filter(poly => ar(poly) > 0.05) })).filter(sl => sl.g.length) : null;
    return { geom, slabs };
  }

  async function buildShapeFitTest(model, st, JSZip) {
    const fr = st.frame, pr = st.print, half = fr.rib / 2, PC = root.polygonClipping;
    const sec = pickSection(model, st);
    if (!sec) return null;
    const ring = p => { const r = p.slice(); r.push(r[0]); return r; };
    // the cells, plus a full rib all round them: a strip along every edge and a small disc on every corner (an
    // offset outline would put long spikes on the sharp corners, which pull in stubs of the ribs beyond)
    // each half only from its own cells (a strip round the other tile's cells would pull in a stub of this tile's
    // seam rib past the end of the stretch)
    const clipOf = id => { const r0 = half + 0.05, parts = [];
    sec.cells.filter(c => c.tile === id).forEach(c => {
      const P = c.tpoly; parts.push([ring(E.ccw(P))]);
      P.forEach((a, i) => {
        const b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) return;
        const nx = -(b[1] - a[1]) / L * r0, ny = (b[0] - a[0]) / L * r0;
        parts.push([ring(E.ccw([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]))]);
        parts.push([ring(Array.from({ length: 12 }, (_, k) => [a[0] + r0 * 1.04 * Math.cos(k * Math.PI / 6), a[1] + r0 * 1.04 * Math.sin(k * Math.PI / 6)]))]);
      });
    });
    return PC.union(...parts); };
    const tA = model.tiles.find(t => t.id === sec.A), tB = model.tiles.find(t => t.id === sec.B);
    const fA = tA && cutTile(tA, clipOf(sec.A)), fB = tB && cutTile(tB, clipOf(sec.B));
    if (!fA || !fB) return null;
    // the pieces: each with its own clearance, made by building the design again with that clearance (the frame does
    // not change with it; the clamps must land in the same places, or that clearance is left out)
    const pcs = sec.cells.filter(c => c.kind === 'piece');
    const base = fr.clr ?? 0.07;
    const pool = Array.from(new Set([0.03, 0.05, 0.07, 0.10, 0.15, +base.toFixed(2)])).sort((a, b) => a - b);
    // the clearances nearest the current one, as many as there are pieces (at most the whole pool)
    const want = pool.slice().sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || a - b).slice(0, Math.min(pcs.length, pool.length)).sort((a, b) => a - b);
    const same = (p, q) => Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01;
    const variants = new Map();
    for (const v of want) {
      if (Math.abs(v - base) < 1e-9) { variants.set(v, model); continue; }
      try {
        const s2 = JSON.parse(JSON.stringify(st)); s2.frame.clr = v; if (s2.frame.hang) s2.frame.hang.on = false;
        const m2 = E.build(s2, true);
        if (sec.clamps.every(k => m2.clamps.some(q => same(q.m, k.m)))) variants.set(v, m2);
      } catch (e) { /* that clearance is left out */ }
    }
    const vals = want.filter(v => variants.has(v));
    // pieces in order along the seam, clearances handed out from tight to loose; extra pieces keep the current one
    const ax = sec.clamps.length > 1 ? [sec.clamps[sec.clamps.length - 1].m[0] - sec.clamps[0].m[0], sec.clamps[sec.clamps.length - 1].m[1] - sec.clamps[0].m[1]] : sec.clamps[0].u;
    pcs.sort((p, q) => (p.c[0] - q.c[0]) * ax[0] + (p.c[1] - q.c[1]) * ax[1]);
    const items = [], lines = [], placed = [];
    pcs.forEach((c, i) => {
      const v = i < vals.length ? vals[i] : base, mv = variants.get(v) || model;
      const pc0 = mv.pieces.find(q => q.tile === c.tile && same(q.c, c.c)) || c;
      const chamfer = Math.max(0.6, half + v - fr.gap / 2);
      const pc = { collar: pc0.collar, body: pc0.body, notch: pc0.notch, apex: E.centroid(pc0.body), z0: fr.t + chamfer, zApex: fr.t + chamfer + 6 + (i % 6) * 3, layers: [], num: c.num };
      const raw = E.pieceMesh(pc, fr, { label: true }), m = E.localize(raw);
      placed.push({ kind: 'piece', mesh: raw, band: c.band });
      const bb = E.bbox(chunk(m.v));
      items.push({ w: bb.w + 1, h: bb.h + 1, ref: { name: `fit-piece-${c.num}-${v.toFixed(2)}mm`, mesh: m } });
      lines.push(`חלק ${c.num} (גובה ${pc.zApex.toFixed(0)} מ"מ${pc0.notch && pc0.notch.length ? ', עם מגרעת לרגל החבק' : ''}): מרווח ${v.toFixed(2)} מ"מ לכל צד${Math.abs(v - base) < 1e-9 ? ' (ההגדרה הנוכחית)' : ''}`);
    });
    [[fA, tA], [fB, tB]].forEach(([f, tl], i) => {
      const raw = E.tileMesh(f, fr), m = E.localize(raw), bb = E.bbox(chunk(m.v));
      placed.push({ kind: 'frame', mesh: raw, tile: i });
      items.push({ w: bb.w + 1, h: bb.h + 1, ref: { name: `fit-frame-${tl.label}`, mesh: m, big: true } });
    });
    // clamps: one at the current clearance for every place in the stretch, and the five graded ones (roof grooves)
    const S = model.clampSpec, clLines = [];
    const addClamp = (cc, marks, name) => { const m = E.localize(E.clampMesh(S, cc, marks)), bb = E.bbox(chunk(m.v)); items.push({ w: bb.w + 1, h: bb.h + 1, ref: { name, mesh: m } }); };
    sec.clamps.forEach((k, i) => { addClamp(S.cc, 0, `fit-clamp-current-${i + 1}`); placed.push({ kind: 'clamp', mesh: E.clampPlaced(k, S) }); });
    [0, 0.05, 0.10, 0.15, 0.20].forEach((cc, i) => { addClamp(cc, i + 1, `fit-clamp-${cc.toFixed(2)}mm`); clLines.push(`חבק עם ${i + 1} חריצים בגג: מרווח ${cc.toFixed(2)} מ"מ לכל צד`); });
    const plates = E.packPlates(items, Object.assign({}, pr, { spacing: Math.max(pr.spacing, 4) }));
    const zip = new JSZip();
    for (let p = 0; p < plates.length; p++) {
      const o = [], merged = new E.Mesh();
      plates[p].items.forEach(it => { const m = it.rot ? E.localize(it.ref.mesh, true) : it.ref.mesh; o.push({ name: it.ref.name, mesh: m, x: it.x, y: it.y }); merged.append(m, it.x, it.y, 0); });
      const nm = 'fit-test' + (plates.length > 1 ? '-' + (p + 1) : '');
      zip.file(nm + '.3mf', await zip3mf(JSZip, o, fr.color || '#85898c'));
      zip.file(nm + '.stl', E.stlBinary(merged, nm));
    }
    zip.file('fit-map.svg', sectionSVG(model, st, sec));
    zip.file('README.txt', [
      `בדיקת התאמה מתוך העיצוב: ${st.name || 'פאנל'}`, '',
      `זה קטע אמיתי מהמסגרת שלך: התפר בין אריח ${tA.label} לאריח ${tB.label}, עם ${sec.clamps.length} מקומות לחבקים ו-${pcs.length} תאים משני הצדדים, בדיוק בצורה שלהם (בוורונוי התפר מזוגזג לפי גבולות התאים).`,
      'fit-map.svg מראה איפה הקטע נמצא בפאנל.', '',
      'הדפסה: הכול בלי תמיכות. החבקים עומדים על הצד בצורת ח; אם קשה להם להיצמד, הוסף שוליים (brim).',
      'הרכבה: הנח את שני חלקי המסגרת צמודים לאורך התפר המזוגזג ולחץ חבק לכל מגרעת בתפר, מלמעלה, עד שהגג שלו בגובה המסגרת.',
      `החבקים בלי חריצים מודפסים לפי ההגדרה הנוכחית (${S.cc.toFixed(2)} מ"מ), אחד לכל מקום. החבקים עם החריצים בודקים מרווחים אחרים: בחר את הראשון שנכנס בלחיצת אצבע ומחזיק את שני החלקים צמודים, והזן את המרווח שלו תחת "מרווח בחבק".`,
      'אחר כך נעץ כל חלק בתא שלו (המספר שקוע בתחתית החלק ותואם את המפה). כל חלק מודפס במרווח אחר; בחר את הראשון שנכנס ביד בלחיצה ונשאר תפוס כשהופכים את המסגרת, והזן את המרווח שלו תחת "מרווח התאמה".',
      'החלקים שליד חבק בודקים גם את המגרעת לרגל החבק: הם צריכים להיכנס כשהחבק כבר במקום.', '',
      ...lines, '', ...clLines].join('\r\n'));
    return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), section: { tiles: [tA.label, tB.label], clamps: sec.clamps.length, pieces: pcs.length, plates: plates.length, clearances: vals }, placed };
  }

  // the whole panel with the test stretch picked out
  function sectionSVG(model, st, sec) {
    const svg = assemblySVG(model, st), fy = y => -y, sel = new Set(sec.cells);
    const add = [];
    sec.cells.forEach(c => add.push(`<path d="${polyPath(c.poly, fy)}" fill="#0a58ca" fill-opacity="0.18" stroke="#0a58ca" stroke-width="0.9"/>`));
    sec.clamps.forEach(k => add.push(`<circle cx="${fmt(k.m[0])}" cy="${fmt(fy(k.m[1]))}" r="3" fill="none" stroke="#c0392b" stroke-width="0.8"/>`));
    return svg.replace('</svg>', add.join('\n') + '\n</svg>');
  }

  root.WallKit = { buildKit, buildFitTest, buildShapeFitTest, pickSection, assemblySVG, plateSVG, hull };
})(typeof window !== 'undefined' ? window : globalThis);
