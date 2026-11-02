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
    // frame tile outlines (tiles follow whole cells and lock with dovetails)
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
    L.push('5. חבר את אריחי המסגרת (קווים כחולים מקווקווים במפה) בדבק מגע/CA על משטח שטוח, הנח את המפה מתחת ונעץ חלקים לפי המספרים.');
    if ((model.mounts || []).length) {
      L.push('6. תלייה: בארבע הפינות יש מאחור חור מנעול בצורת L (באדום במפה). ראש הבורג נכנס בעיגול, והפאנל מחליק למטה כך שהבורג נתפס בקצה הזרוע.');
      L.push('   כל פינה עליונה עובדת בשני הכיוונים: הזרוע האנכית לתלייה לאורך, והזרוע לכיוון הצד לתלייה לרוחב. תמיד משתמשים בשני הברגים העליונים.');
      L.push('   מיקום הברגים בקיר: הצלבים האדומים בקצות הזרועות שפונות למעלה. השאר את הבורג בולט מהקיר ' + (model.hangLevels.lip + st.frame.hang.headH).toFixed(1) + ' מ"מ עד קצה הראש (' + model.hangLevels.lip.toFixed(1) + ' מ"מ של גוף הבורג ועוד ראש בעובי ' + st.frame.hang.headH + ' מ"מ).');
      L.push('   המסגרת נשארת בעובי רגיל והחלקים נראים בדיוק כמו בלי חורי תלייה. מתחת לחלק שמעל החור התא במסגרת מלא, ועליו טבעת נמוכה; בתחתית החלק יש חלל שנכנס על הטבעת וממשיך כמקום לראש הבורג. אריח עם חור תלייה בנוי מכמה שכבות גוף חופפות; PrusaSlicer מאחד אותן בפריסה.');
    }
    L.push('');
    L.push('קבצים: ' + sm.plates.length + ' פלטות חלקים, ' + sm.tiles.length + ' אריחי מסגרת.');
    L.push('design.json: ההגדרות של העיצוב. אפשר לטעון אותו בחזרה באפליקציה.');
    return L.join('\r\n');
  }

  // small strip to dial in press-fit clearance: 5 square cells, 5 pieces with growing clearance.
  // The taller the piece, the looser it is, so they can be told apart without labels.
  async function buildFitTest(st, JSZip) {
    const fr = st.frame, pr = st.print, half = fr.rib / 2;
    const cs = 24, n = 5, rim = 5;
    const clrs = [0.00, 0.025, 0.05, 0.10, 0.15]; // centred on the 0.05 mm that fit best on the MK4
    const W = n * cs + 2 * rim, H = cs + 2 * rim;
    const cells = [];
    for (let i = 0; i < n; i++) {
      const x0 = -W / 2 + rim + i * cs, y0 = -cs / 2;
      cells.push([[x0, y0], [x0 + cs, y0], [x0 + cs, y0 + cs], [x0, y0 + cs]]);
    }
    const ring = p => p.concat([p[0]]);
    const PCl = root.polygonClipping;
    const jh2 = Math.max(half, (fr.joint ?? 9) / 2), jc = fr.jointClr ?? 0.1;
    // the seam between cell 3 and 4 gets the wide rib and a dovetail, exactly like the real frame
    const openings = cells.map((c, i) => E.inset(c, [half, i === 2 ? jh2 : half, half, i === 3 ? jh2 : half]));
    const xs = -W / 2 + rim + 3 * cs;
    const left = [[-W / 2, -H / 2], [xs, -H / 2], [xs, H / 2], [-W / 2, H / 2]], right = [[xs, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [xs, H / 2]];
    const w1 = fr.knobW ?? 5, w2 = w1 + 2.4, jh = Math.max(1.6, jh2 - 1.6);
    const dt = (w1_, w2_, h_, back) => [[xs - back, -w1_ / 2], [xs - back, w1_ / 2], [xs, w1_ / 2], [xs + h_, w2_ / 2], [xs + h_, -w2_ / 2], [xs, -w1_ / 2]].reverse();
    const holes = openings.map(o => [ring(o)]);
    const gA = PCl.difference(PCl.union([ring(left)], [ring(E.ccw(dt(w1, w2, jh, 1.2)))]), ...holes);
    const gB = PCl.difference([ring(right)], [ring(E.ccw(dt(w1 + 2 * jc, w2 + 2 * jc, jh + jc, 0.6)))], ...holes);
    const mA = E.localize(E.extrudeGeom(new E.Mesh(), gA, 0, fr.t)), mB = E.localize(E.extrudeGeom(new E.Mesh(), gB, 0, fr.t));
    const objs = [{ name: 'fit-frame-A', mesh: mA, x: 20, y: pr.bedH - H - 20 }, { name: 'fit-frame-B', mesh: mB, x: 20 + 3 * cs + rim + 15, y: pr.bedH - H - 20 }];
    const merged = new E.Mesh().append(mA, objs[0].x, objs[0].y, 0).append(mB, objs[1].x, objs[1].y, 0);
    const lines = [];
    cells.forEach((c, i) => {
      const op = openings[i], clr = clrs[i];
      const chamfer = Math.max(0.6, (i === 2 || i === 3 ? jh2 : half) + clr - fr.gap / 2);
      const pc = { collar: E.inset(op, clr), body: E.inset(c, fr.gap / 2), apex: E.centroid(c), z0: fr.t + chamfer, zApex: fr.t + chamfer + 6 + i * 3, layers: [] };
      const m = E.localize(E.pieceMesh(pc, fr));
      const x = (pr.bedW - W) / 2 + i * (cs + 6), y = 20;
      objs.push({ name: `fit-${clr.toFixed(2)}mm`, mesh: m, x, y });
      merged.append(m, x, y, 0);
      lines.push(`חלק ${i + 1} (גובה ${(pc.zApex).toFixed(0)} מ"מ): מרווח ${clr.toFixed(2)} מ"מ לכל צד`);
    });
    const zip = new JSZip();
    zip.file('fit-test.3mf', await zip3mf(JSZip, objs, fr.color || '#85898c'));
    zip.file('fit-test.stl', E.stlBinary(merged, 'fit test'));
    zip.file('README.txt', ['בדיקת התאמה ל-MK4', '', 'הדפס את הקובץ (פלטה אחת, בלי תמיכות), ונסה לנעוץ כל חלק בתא שלו.', 'בחר את החלק הראשון שנכנס ביד בלחיצה ונשאר תפוס כשהופכים את המסגרת, והזן את המרווח שלו באפליקציה תחת "מרווח התאמה".', 'המסגרת מודפסת בשני חלקים עם מחבר זנב יונה, כמו באריחים האמיתיים. אם המחבר רופף או צפוף, שנה את "מרווח במחבר".', '', ...lines].join('\r\n'));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  root.WallKit = { buildKit, buildFitTest, assemblySVG, plateSVG, hull };
})(typeof window !== 'undefined' ? window : globalThis);
