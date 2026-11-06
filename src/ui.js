import * as THREE from 'three';

const E = window.WallEngine, K = window.WallKit, PR = window.WallPresets;
const $ = s => document.querySelector(s);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- state, history, persistence ----------
const LS_KEY = 'tavlit-design-v2';
let state = loadLocal() || clone(PR.presets[1].state);
let history = [JSON.stringify(state)], hIndex = 0;
let model = null, buildError = null;
let selPoint = 0, selBand = 0, addMode = null;
const openSecs = new Set();   // every section starts closed; a click on its title opens it

function loadLocal() { try { const s = localStorage.getItem(LS_KEY); return s ? normalize(JSON.parse(s)) : null; } catch (e) { return null; } }
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }
function normalize(s) {
  const base = clone(PR.presets[1].state);
  for (const k of Object.keys(base)) if (typeof base[k] === 'object' && !Array.isArray(base[k])) s[k] = Object.assign({}, base[k], s[k] || {});
  s.move.points = (s.move.points || []).map(p => Object.assign({ type: 'vortex', x: 0, y: 0, strength: 1, radius: 80, fade: 120, opening: 0, angle: 0, curve: 0, spiral: 0 }, p));
  s.piece = Object.assign({ curve: 0, twist: 0, spiral: 0, profile: 1, layers: 10, smooth: 0, truncate: 0, dome: 0, cutTilt: 0, cutBy: 'field', cutAngle: 0, cutVary: 0 }, s.piece || {});
  if (s.piece.cutOn === undefined) s.piece.cutOn = s.piece.cutTilt > 0;   // designs saved before the switch keep their look
  s.frame = Object.assign({ jointClr: 0.2, clampEvery: 40, clampLen: 6, clampClr: 0.1 }, s.frame);
  delete s.frame.joint; delete s.frame.knobW;   // dovetails gave way to separate clamps (2026-11-06)
  // Uri's fit test on the MK4 (2026-11-02): 0.05 mm fits best; move designs still on the old 0.15 default
  if (!s.fitCal) { if (s.frame.clr === 0.15) s.frame.clr = 0.05; s.fitCal = 1; }
  // Uri's printed frame (2026-11-02): tiles at 0.05 mm were too tight to join; dovetails default to 0.1 mm.
  // Press-fit (frame.clr) stays 0.05. Move designs still on an old dovetail default (0.15 / 0.05) to 0.1.
  if (s.fitCal < 2) { if (s.frame.jointClr === 0.15 || s.frame.jointClr === 0.05) s.frame.jointClr = 0.1; s.fitCal = 2; }
  // Uri (2026-11-04): press-fit 0.05 -> 0.07 and tile dovetails 0.1 -> 0.2 by default. Designs still on the
  // previous defaults move up; values someone set by hand stay.
  if (s.fitCal < 3) { if (s.frame.clr === 0.05) s.frame.clr = 0.07; if (s.frame.jointClr === 0.1) s.frame.jointClr = 0.2; s.fitCal = 3; }
  s.frame.hang = Object.assign({ on: true, head: 8.5, shank: 4.5, headH: 3, slot: 9 }, s.frame.hang || {});
  if (!Array.isArray(s.color.bands) || !s.color.bands.length) s.color.bands = base.color.bands;
  s.name = s.name || 'עיצוב חדש';
  return s;
}
function commit() {
  const j = JSON.stringify(state);
  if (j === history[hIndex]) return;
  history = history.slice(0, hIndex + 1); history.push(j);
  if (history.length > 80) history.shift();
  hIndex = history.length - 1;
  saveLocal(); updateUndo();
}
function updateUndo() { $('#undoBtn').disabled = hIndex <= 0; $('#redoBtn').disabled = hIndex >= history.length - 1; }
function restore(i) { hIndex = i; state = normalize(JSON.parse(history[i])); selPoint = Math.min(selPoint, Math.max(0, state.move.points.length - 1)); selBand = Math.min(selBand, state.color.bands.length - 1); renderPanel(); schedule(); updateUndo(); saveLocal(); }

const getP = (path) => path.split('.').reduce((o, k) => o?.[k], state);
const setP = (path, v) => { const ks = path.split('.'); let o = state; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; };

// ---------- UI building blocks ----------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
let uid = 0;
function slider(label, hint, path, min, max, step, unit = '', opts = {}) {
  const id = 'c_' + path.replace(/\./g, '_');
  const v = getP(path);
  const num = el('input', { id, type: 'number', min, max, step, value: v, inputmode: 'decimal' });
  const rng = el('input', { type: 'range', min, max, step, value: v, 'aria-label': label });
  const apply = (val, fin) => {
    let x = parseFloat(val); if (!isFinite(x)) return;
    x = Math.max(opts.hardMin ?? -Infinity, Math.min(opts.hardMax ?? Infinity, x));
    setP(path, x); num.value = x; rng.value = x; opts.onChange?.(x);
    schedule(!fin); if (fin) { commit(); opts.onCommit?.(); }
  };
  if (!opts.virtual) {
    rng.addEventListener('input', () => apply(rng.value, false));
    rng.addEventListener('change', () => apply(rng.value, true));
    num.addEventListener('change', () => apply(num.value, true));
  }
  return el('div', { class: 'row' }, el('label', { for: id }, label, hint ? el('small', {}, hint) : null), el('div', { class: 'num' }, num, unit ? el('span', {}, unit) : null), rng);
}
function chips(label, path, options, onPick) {
  const cur = getP(path);
  return el('div', {}, label ? el('div', { class: 'field-label', style: 'margin-bottom:6px' }, label) : null,
    el('div', { class: 'chips', role: 'group', 'aria-label': label || '' }, options.map(([val, text]) =>
      el('button', { class: 'chip', 'aria-pressed': String(cur === val), onclick: () => { setP(path, val); onPick?.(val); commit(); renderPanel(); schedule(); } }, text))));
}
function section(key, n, title, summary, body) {
  const s = el('section', { class: 'sec' + (openSecs.has(key) ? ' open' : '') });
  const head = el('button', { class: 'sec-head', 'aria-expanded': String(openSecs.has(key)), onclick: () => { openSecs.has(key) ? openSecs.delete(key) : openSecs.add(key); s.classList.toggle('open'); head.setAttribute('aria-expanded', String(openSecs.has(key))); if (key === 'move') drawPlan(); } },
    el('span', { class: 'hexnum' }, String(n)), el('span', {}, el('span', { class: 'sec-title' }, title), el('span', { class: 'sec-sum' }, summary)),
    el('svg', { class: 'chev', width: 14, height: 14, viewBox: '0 0 24 24' }));
  head.querySelector('svg').innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/>';
  s.append(head, el('div', { class: 'sec-body' }, body));
  return s;
}

const SHAPES = [['rect', 'מלבן'], ['circle', 'עיגול'], ['ellipse', 'אליפסה'], ['hexagon', 'משושה'], ['octagon', 'מתומן']];
const TESS = [['hex', 'משושים'], ['square', 'ריבועים'], ['triangle', 'משולשים'], ['radial', 'רדיאלי'], ['voronoi', 'וורונוי'], ['sunflower', 'חמנייה']];
const SURF = [['flat', 'שטוח'], ['dome', 'כיפה'], ['bowl', 'קערה'], ['cone', 'חרוט'], ['ring', 'טבעת'], ['wave', 'גל'], ['ripple', 'אדוות'], ['tilt', 'שיפוע'], ['noise', 'אורגני']];
const CUTBY = [['field', 'לפי התנועה'], ['radial', 'מהמרכז החוצה'], ['spiral', 'ספירלה'], ['surface', 'שיפוע פני השטח'], ['fixed', 'כיוון קבוע']];
const COLBY = [['height', 'לפי גובה'], ['gradient', 'מעבר'], ['radial', 'מהמרכז'], ['field', 'לפי תנועה'], ['random', 'אקראי']];
const name = (list, v) => (list.find(x => x[0] === v) || [, v])[1];
const PT = {
  vortex: { label: 'מערבולת', sub: 'סיבוב מסביב', icon: '<path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 8a4 4 0 1 1-4 4M12 4a8 8 0 1 1-8 8" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
  magnet: { label: 'מגנט', sub: 'מושך או דוחה', icon: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>' },
  current: { label: 'זרם', sub: 'הכול לכיוון אחד', icon: '<path d="M3 7h14l-3-3M3 12h16l-3-3M3 17h14l-3-3" fill="none" stroke="currentColor" stroke-width="1.6"/>' }
};

// ---------- panel ----------
function renderPanel() {
  const panel = $('#panel'); const scroll = panel.scrollTop;
  panel.textContent = '';
  const s = state;
  $('#designName').value = s.name;

  // 1 size & shape
  panel.append(section('shape', 1, 'גודל וצורה', `${name(SHAPES, s.shape.type)} · ${(s.shape.w / 10).toFixed(0)}×${(s.shape.h / 10).toFixed(0)} ס"מ`, [
    chips('', 'shape.type', SHAPES, v => { if (v === 'circle') s.shape.h = s.shape.w; }),
    slider('רוחב', '', 'shape.w', 100, 1500, 5, 'מ"מ', { hardMin: 60, onChange: v => { if (s.shape.type === 'circle') s.shape.h = v; } }),
    s.shape.type === 'circle' ? null : slider('גובה', '', 'shape.h', 100, 1500, 5, 'מ"מ', { hardMin: 60 }),
    s.frame.hideRim ? el('p', { class: 'hint' }, 'המסגרת ההיקפית מוסתרת בתוך החלקים (ב"מסגרת והתאמה"), ולכן אין שוליים גלויים.') : slider('שוליים', 'המסגרת החיצונית', 'shape.rim', 3, 30, 0.5, 'מ"מ')
  ]));

  // 2 pieces / tessellation
  const t = s.tess;
  panel.append(section('tess', 2, 'חלקים', `${name(TESS, t.type)} · תא ${t.size} מ"מ`, [
    chips('', 'tess.type', TESS),
    slider('גודל תא', 'רוחב חלק אחד', 'tess.size', 14, 90, 1, 'מ"מ', { hardMin: 10 }),
    t.type === 'voronoi' ? slider('סדר', 'כמה התאים אחידים', 'tess.relax', 0, 8, 1, '') : null,
    t.type === 'voronoi' ? el('div', { class: 'btn-row' }, el('button', { class: 'btn small', onclick: () => { t.seed = (t.seed || 1) + 1; commit(); schedule(); } }, 'פיזור אחר')) : null,
    t.type === 'radial' ? slider('פיתול', 'הזזת כל טבעת', 'tess.twist', -3, 3, 0.1, '') : null,
    t.type === 'radial' ? slider('חלקים במרכז', '', 'tess.center', 5, 16, 1, '') : null,
    slider('תא קטן מינימלי', 'קטן מזה נשאר סגור במסגרת', 'tess.minFrac', 0.1, 0.8, 0.05, '')
  ]));

  // 3 surface
  const f = s.surface;
  panel.append(section('surface', 3, 'פני שטח', `${name(SURF, f.type)} · עומק ${f.depth} מ"מ`, [
    chips('', 'surface.type', SURF),
    slider('גובה מינימלי', 'החלק הנמוך ביותר', 'surface.minH', 2, 40, 0.5, 'מ"מ'),
    f.type === 'flat' ? null : slider('עומק', 'הפרש בין נמוך לגבוה', 'surface.depth', 0, 80, 1, 'מ"מ'),
    ['wave', 'ripple', 'noise'].includes(f.type) ? slider('תדירות', '', 'surface.freq', 0.5, 8, 0.1, '') : null,
    ['wave', 'tilt'].includes(f.type) ? slider('זווית', '', 'surface.angle', -180, 180, 1, '°') : null,
    f.type === 'ring' ? slider('רדיוס הטבעת', 'יחסית לגודל', 'surface.ring', 0.1, 1, 0.01, '') : null,
    f.type === 'noise' ? el('div', { class: 'btn-row' }, el('button', { class: 'btn small', onclick: () => { f.seed = (f.seed || 1) + 1; commit(); schedule(); } }, 'דוגמה אחרת')) : null
  ]));

  // 4 piece shape
  const pc = s.piece;
  panel.append(section('piece', 4, 'צורת החלק', `קימור ${pc.curve} · פיתול ${pc.twist}° · סחרור ${pc.spiral}°`, [
    el('p', { class: 'hint' }, 'כל חלק בנוי משכבות שמצטמצמות כלפי הקודקוד. כאן קובעים אם הוא עולה ישר כמו פירמידה, או מתעקל, מסתובב ומסתחרר כמו קרן או טופר.'),
    slider('קימור', 'ישר, או נשאר זקוף ומתכופף למעלה', 'piece.curve', -0.6, 1.5, 0.05, ''),
    slider('פיתול', 'סיבוב החתך סביב עצמו', 'piece.twist', -180, 180, 1, '°'),
    slider('סחרור', 'הקודקוד מסתובב בספירלה תוך כדי עלייה', 'piece.spiral', -180, 180, 1, '°'),
    slider('עובי', 'קטן = נפוח, גדול = דק וחד', 'piece.profile', 0.4, 2.5, 0.05, ''),
    slider('שכבות', 'יותר = עיקול חלק יותר', 'piece.layers', 3, 48, 1, ''),
    slider('התמזגות לצורה אחת', 'הפאות של הבסיס נמסות בהדרגה לצורה עגולה וחלקה כלפי מעלה', 'piece.smooth', 0, 1, 0.05, ''),
    slider('קיטום', '0 = שפיץ מלא, 1 = קטום נמוך, 1.5 = קטום נמוך מאוד', 'piece.truncate', 0, 1.5, 0.05, '', { onCommit: () => renderPanel() }),
    pc.truncate > 0 ? slider('כיפתיות', '0 = חיתוך ישר, 1 = כיפה מעוגלת', 'piece.dome', 0, 1, 0.05, '') : null,
    pc.truncate > 0 ? chips('זווית הקיטום', 'piece.cutOn', [[false, 'כבויה (מקביל לקיר)'], [true, 'פעילה']]) : null,
    pc.truncate > 0 && pc.cutOn ? el('p', { class: 'hint' }, 'משטח החיתוך נוטה ופונה לכיוון מסוים. הכיוון יכול לבוא מנקודות התנועה (מערבולת, מגנט, זרם), מהמרכז, מספירלה או משיפוע פני השטח. לכל נקודת תנועה אפשר גם להוסיף זווית משלה.') : null,
    pc.truncate > 0 && pc.cutOn ? slider('זווית קיטום', '0 = אופקי, מקביל לקיר', 'piece.cutTilt', 0, 75, 1, '°') : null,
    pc.truncate > 0 && pc.cutOn ? chips('מה קובע לאן המשטח פונה', 'piece.cutBy', CUTBY) : null,
    pc.truncate > 0 && pc.cutOn ? slider(pc.cutBy === 'fixed' ? 'כיוון' : 'סיבוב הכיוון', pc.cutBy === 'fixed' ? 'לאן פונה המשטח החתוך' : '180 = הפוך, 90 = לרוחב', 'piece.cutAngle', -180, 180, 1, '°') : null,
    pc.truncate > 0 && pc.cutOn && pc.cutBy !== 'fixed' ? slider('זווית לפי עוצמה', '0 = אותה זווית בכל הלוח, 1 = הזווית גדלה איפה שההשפעה חזקה', 'piece.cutVary', 0, 1, 0.05, '') : null
  ]));

  // 5 movement
  const m = s.move;
  const canvas = el('canvas', { id: 'plan', width: 600, height: 600, 'aria-label': 'תוכנית: לחץ להוספת נקודה, גרור להזזה' });
  const planWrap = el('div', { class: 'plan-wrap' }, canvas, el('div', { class: 'plan-help' }, addMode ? `לחץ על הפאנל כדי להוסיף ${PT[addMode].label}` : 'גרור נקודה כדי להזיז אותה'));
  const tools = el('div', { class: 'tools' }, Object.entries(PT).map(([k, d]) => {
    const b = el('button', { class: 'tool', 'aria-pressed': String(addMode === k), onclick: () => { addMode = addMode === k ? null : k; renderPanel(); } });
    b.innerHTML = `<svg viewBox="0 0 24 24">${d.icon}</svg><span>${d.label}</span><small>${d.sub}</small>`;
    return b;
  }));
  const plist = el('div', { class: 'pointlist' }, m.points.map((p, i) => el('button', { class: 'chip', 'aria-pressed': String(i === selPoint), onclick: () => { selPoint = i; renderPanel(); } }, `${i + 1}. ${PT[p.type].label}`)));
  const p = m.points[selPoint];
  const R = Math.max(s.shape.w, s.shape.h);
  const editor = p ? el('div', { class: 'pt-editor' },
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn small', onclick: () => { const c = clone(p); c.x += 20; c.y -= 20; m.points.push(c); selPoint = m.points.length - 1; commit(); renderPanel(); schedule(); } }, 'שכפל'),
      el('button', { class: 'btn small', onclick: () => { m.points.splice(selPoint, 1); selPoint = Math.max(0, selPoint - 1); commit(); renderPanel(); schedule(); } }, 'מחק')),
    slider(p.type === 'magnet' ? 'עוצמה' : 'עוצמה', p.type === 'magnet' ? 'שלילי = דוחה' : (p.type === 'vortex' ? 'שלילי = נגד כיוון השעון' : ''), `move.points.${selPoint}.strength`, -2, 2, 0.05, ''),
    p.type === 'vortex' ? slider('פתיחה', 'פנימה או החוצה', `move.points.${selPoint}.opening`, -1, 1, 0.05, '') : null,
    p.type === 'current' ? slider('כיוון', '', `move.points.${selPoint}.angle`, -180, 180, 1, '°') : null,
    slider('קימור נוסף', 'לחלקים באזור הנקודה', `move.points.${selPoint}.curve`, -1, 1.5, 0.05, ''),
    slider('סחרור נוסף', 'לחלקים באזור הנקודה', `move.points.${selPoint}.spiral`, -180, 180, 1, '°'),
    s.piece.truncate > 0 && s.piece.cutOn ? slider('זווית קיטום נוספת', 'לחלקים קטומים באזור הנקודה', `move.points.${selPoint}.cut`, -60, 60, 1, '°') : null,
    slider('רדיוס', 'השפעה מלאה', `move.points.${selPoint}.radius`, 0, R, 1, 'מ"מ'),
    slider('דעיכה', 'עד שההשפעה נעלמת', `move.points.${selPoint}.fade`, 1, R * 1.5, 1, 'מ"מ'),
    slider('מיקום אופקי', '', `move.points.${selPoint}.x`, -s.shape.w / 2, s.shape.w / 2, 1, 'מ"מ'),
    slider('מיקום אנכי', '', `move.points.${selPoint}.y`, -s.shape.h / 2, s.shape.h / 2, 1, 'מ"מ')
  ) : el('p', { class: 'hint' }, 'אין נקודות תנועה. בחר סוג נקודה ולחץ על הפאנל.');
  panel.append(section('move', 5, 'תנועה', `${m.points.length} נקודות · הטיה ${m.lean}`, [
    el('p', { class: 'hint' }, 'נקודות על הפאנל מכוונות את קודקודי החלקים. הקווים בתוכנית מראים לאן כל קודקוד נוטה.'),
    planWrap, tools, plist, editor,
    slider('הטיה כללית', 'כמה הקודקודים נוטים', 'move.lean', 0, 2, 0.05, ''),
    slider('הגבהה לפי תנועה', 'חדים יותר איפה שהמשיכה חזקה', 'move.pull', 0, 1, 0.05, '')
  ]));
  bindPlan(canvas);

  // 5 frame & fit
  const fr = s.frame;
  panel.append(section('frame', 6, 'מסגרת והתאמה', `עובי ${fr.t} · מרווח ${fr.clr} מ"מ`, [
    el('p', { class: 'hint' }, 'הלוח שנתלה על הקיר. כל חלק ננעץ בתא שלו. כדאי להתחיל ב"בדיקת התאמה" כדי לכייל את המרווח למדפסת שלך. ברירת המחדל למרווח הנעיצה היא 0.07 מ"מ ולמרווח בחבקים שבין האריחים 0.1 מ"מ, לפי בדיקות ההדפסה על ה-MK4.'),
    slider('עובי המסגרת', '', 'frame.t', 2, 6, 0.2, 'מ"מ'),
    slider('רוחב צלע', 'בין התאים', 'frame.rib', 1.6, 6, 0.1, 'מ"מ'),
    slider('מרווח התאמה', 'לכל צד, נעיצה · ברירת מחדל 0.07', 'frame.clr', 0, 0.5, 0.01, 'מ"מ'),
    slider('רווח בין חלקים', '', 'frame.gap', 0.1, 2, 0.05, 'מ"מ'),
    chips('המסגרת ההיקפית', 'frame.hideRim', [[false, 'בולטת'], [true, 'מוסתרת בתוך החלקים']]),
    el('p', { class: 'hint' }, fr.hideRim
      ? 'החלקים שבשולי הפאנל נמשכים עד הקצה ויורדים עד הקיר, כך שהם מכסים את הפס ההיקפי של המסגרת ונראה כאילו הם יוצאים מתוך הקיר. הפאה החיצונית המשופעת של כל חלק כזה ממשיכה באותו מישור כלפי הקיר, ונחתכת בקו היקפי אחיד אחד: הקו שבו מסתיים השיפוע הקצר ביותר. משם החלק יורד ישר לקיר, כך שקצה הפאנל נשאר קו רציף ונקי. מתחת לחלק יש מדף שטוח שנח על הפס. הפס עצמו צר כמו צלע בין תאים.'
      : 'המסגרת ההיקפית בולטת סביב הפאנל, ורוחבה נקבע ב"שוליים" בחלק "גודל וצורה". אפשר להסתיר אותה בתוך החלקים שבשוליים.'),
    el('div', { class: 'field-label' }, 'חיבור בין אריחים'),
    el('p', { class: 'hint' }, 'המסגרת מתחלקת לאורך גבולות של תאים שלמים. אריחים שכנים מוחזקים יחד בחבקים: חלקים קטנים בצורת ח שמודפסים בנפרד. בכל חבק יש בצלע מגרעת מלמעלה, שבה יושב גג החבק, ומגרעת בכל צד, שבה יורדות הרגליים ולוחצות את שני האריחים זה אל זה. החלקים שליד החבק מקבלים מגרעת קטנה בצוואר, כך שהחבק נסתר מתחתם. אין צורך לדחוס חלקים זה לתוך זה, והאריחים לא מתעקמים.'),
    slider('מרחק בין חבקים', 'קטן יותר = יותר חבקים בכל חיבור', 'frame.clampEvery', 15, 120, 5, 'מ"מ'),
    slider('אורך חבק', 'לאורך החיבור', 'frame.clampLen', 4, 12, 0.5, 'מ"מ'),
    slider('מרווח בחבק', 'לכל צד · ברירת מחדל 0.1 · גדול יותר = רופף יותר', 'frame.clampClr', 0, 0.4, 0.01, 'מ"מ'),
    slider('רווח בין אריחים', 'ברירת מחדל 0.2', 'frame.jointClr', 0, 0.4, 0.01, 'מ"מ'),
    el('div', { class: 'field-label' }, 'תלייה על הקיר'),
    el('p', { class: 'hint' }, 'חורי התלייה לא מחושבים בזמן העבודה, כדי שהכול יגיב מהר. בלחיצה על "הורד ערכת הדפסה" תישאל אם להוסיף אותם, ואז הם מתווספים לחלקים ולמפת ההרכבה. ליד כל פינה יש מאחור חור מנעול בצורת L: ראש הבורג נכנס בעיגול, והפאנל מחליק עד שהבורג נתפס בקצה הזרוע. הזרוע האנכית לתלייה לאורך והזרוע שפונה לצד לתלייה לרוחב, ותמיד משתמשים בשני הברגים העליונים. החלקים והחלוקה נראים בדיוק כמו בלי חורי תלייה: החור ממוקם רק מתחת לחלק שיש בתוכו מקום לחלל, גם אם הוא לא בפינה ממש.'),
    slider('קוטר ראש הבורג', '', 'frame.hang.head', 6, 12, 0.1, 'מ"מ'),
    slider('קוטר גוף הבורג', '', 'frame.hang.shank', 3, 6, 0.1, 'מ"מ'),
    slider('עובי ראש הבורג', 'דק יותר = יותר חלקים מתאימים', 'frame.hang.headH', 2, 6, 0.1, 'מ"מ'),
    slider('אורך ההחלקה', '', 'frame.hang.slot', 8, 20, 0.5, 'מ"מ'),
    slider('זווית מקסימלית בלי תמיכות', '', 'print.overhang', 30, 60, 1, '°'),
    el('div', {}, el('div', { class: 'field-label', style: 'margin-bottom:6px' }, 'צבע המסגרת'), swatchGrid(fr.color, c => { fr.color = c; commit(); renderPanel(); schedule(); }))
  ]));

  // 6 colours
  const col = s.color;
  const bandBtns = el('div', { class: 'bands' }, col.bands.map((c, i) => el('button', { class: 'band', style: `background:${c};color:${ink(c)}`, 'aria-pressed': String(i === selBand), 'aria-label': `רצועה ${i + 1}`, onclick: () => { selBand = i; renderPanel(); } }, String(i + 1))));
  panel.append(section('color', 7, 'צבעים', `${col.bands.length} צבעים · ${name(COLBY, col.by)}`, [
    slider('מספר צבעים', 'גליל אחד לכל צבע', '__bands', 1, 6, 1, '', { virtual: true }),
    chips('צביעה', 'color.by', COLBY),
    col.by === 'gradient' ? slider('כיוון המעבר', '', 'color.angle', -180, 180, 1, '°') : null,
    col.by === 'random' ? el('div', { class: 'btn-row' }, el('button', { class: 'btn small', onclick: () => { col.seed = (col.seed || 1) + 1; commit(); schedule(); } }, 'ערבב מחדש')) : null,
    el('div', { class: 'field-label' }, 'רצועות, מהנמוך לגבוה'),
    el('div', { class: 'btn-row' }, bandBtns, el('button', { class: 'btn small', title: 'הפוך סדר', onclick: () => { col.bands.reverse(); selBand = col.bands.length - 1 - selBand; commit(); renderPanel(); schedule(); } }, '⇄')),
    swatchGrid(col.bands[selBand], c => { col.bands[selBand] = c; commit(); renderPanel(); schedule(); })
  ]));
  // band-count slider is virtual
  const bs = panel.querySelector('#c___bands');
  if (bs) {
    const row = bs.closest('.row'), rng = row.querySelector('input[type=range]');
    const setN = (n, fin) => {
      n = Math.max(1, Math.min(6, Math.round(n))); bs.value = n; rng.value = n;
      const cur = col.bands;
      while (cur.length < n) cur.push(PR.palette[(cur.length * 5 + 3) % PR.palette.length][1]);
      cur.length = n; selBand = Math.min(selBand, n - 1); schedule();
      if (fin) { commit(); renderPanel(); }
    };
    bs.value = col.bands.length; rng.value = col.bands.length;
    rng.oninput = () => setN(+rng.value, false); rng.onchange = () => setN(+rng.value, true); bs.onchange = () => setN(+bs.value, true);
  }

  // 7 printer
  const pr = s.print;
  panel.append(section('print', 8, 'מדפסת', `${pr.bedW}×${pr.bedH} מ"מ (Prusa MK4)`, [
    el('p', { class: 'hint' }, 'ברירת המחדל מתאימה ל-Prusa MK4. האפליקציה מחלקת את המסגרת לאריחים ואת החלקים לפלטות לפי הגודל הזה.'),
    slider('רוחב משטח', '', 'print.bedW', 120, 400, 1, 'מ"מ'),
    slider('עומק משטח', '', 'print.bedH', 120, 400, 1, 'מ"מ'),
    slider('גובה הדפסה', '', 'print.bedZ', 100, 400, 1, 'מ"מ'),
    slider('שוליים במשטח', '', 'print.margin', 0, 20, 1, 'מ"מ'),
    slider('רווח בין חלקים בפלטה', '', 'print.spacing', 1, 10, 0.5, 'מ"מ'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: pr.engrave !== false, onchange: (e) => { pr.engrave = e.target.checked; commit(); } }), 'מספר שקוע בתחתית כל חלק'),
    el('p', { class: 'hint' }, 'המספר מהמפה, בגובה 2.5 עד 6 מ"מ ובעומק 0.4 מ"מ (שתי שכבות), בצד שנוגע במשטח ההדפסה. לא נראה כשהפאנל מורכב.')
  ]));
  panel.scrollTop = scroll;
  drawPlan();
}
function ink(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150 ? '#1b211e' : '#fff'; }
function swatchGrid(cur, pick) {
  const g = el('div', { class: 'swatches' }, PR.palette.map(([n, hex]) => el('button', { class: 'sw', style: `background:${hex}`, title: n, 'aria-label': n, 'aria-pressed': String(cur?.toLowerCase() === hex), onclick: () => pick(hex) })));
  const custom = el('input', { type: 'color', value: cur || '#888888', 'aria-label': 'צבע אחר' });
  custom.addEventListener('change', () => pick(custom.value));
  return el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, g, el('label', { class: 'custom-color' }, custom, 'צבע אחר'));
}

// ---------- plan canvas (movement points) ----------
let planCv = null;
function planXf() {
  const cv = planCv, W = cv.width, H = cv.height, s = state.shape;
  const k = Math.min((W - 40) / s.w, (H - 40) / s.h);
  return { k, toPx: (x, y) => [W / 2 + x * k, H / 2 - y * k], toMm: (px, py) => [(px - W / 2) / k, (H / 2 - py) / k] };
}
function bindPlan(cv) {
  planCv = cv;
  const s = state.shape;
  cv.height = Math.round(600 * Math.min(1.2, Math.max(0.5, s.h / s.w)));
  let drag = -1;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.addEventListener('pointerdown', e => {
    const [px, py] = pos(e), X = planXf();
    if (addMode) {
      const [x, y] = X.toMm(px, py);
      const R = Math.max(state.shape.w, state.shape.h);
      state.move.points.push({ type: addMode, x: Math.round(x), y: Math.round(y), strength: 1, radius: Math.round(R * 0.25), fade: Math.round(R * 0.4), opening: 0, angle: 0, curve: 0, spiral: 0 });
      selPoint = state.move.points.length - 1; addMode = null; commit(); renderPanel(); schedule(); return;
    }
    let best = -1, bd = 30;
    state.move.points.forEach((p, i) => { const [qx, qy] = X.toPx(p.x, p.y); const d = Math.hypot(qx - px, qy - py); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { drag = best; selPoint = best; cv.setPointerCapture(e.pointerId); drawPlan(); }
  });
  cv.addEventListener('pointermove', e => {
    if (drag < 0) return;
    const [px, py] = pos(e), [x, y] = planXf().toMm(px, py), s = state.shape;
    const p = state.move.points[drag];
    p.x = Math.round(Math.max(-s.w / 2, Math.min(s.w / 2, x))); p.y = Math.round(Math.max(-s.h / 2, Math.min(s.h / 2, y)));
    drawPlan(); schedule(true);
  });
  const end = () => { if (drag >= 0) { drag = -1; commit(); renderPanel(); schedule(); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function drawPlan() {
  const cv = planCv; if (!cv || !cv.isConnected) return;
  const ctx = cv.getContext('2d'), X = planXf();
  ctx.clearRect(0, 0, cv.width, cv.height);
  const line = cssVar('--line'), inkc = cssVar('--ink'), acc = cssVar('--accent'), muted = cssVar('--muted');
  const path = poly => { ctx.beginPath(); poly.forEach((q, i) => { const [x, y] = X.toPx(q[0], q[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
  if (model) {
    path(model.outer); ctx.fillStyle = line; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    for (const c of model.pieces) { path(c.opening); ctx.fillStyle = state.color.bands[c.band]; ctx.globalAlpha = 0.28; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = inkc; ctx.lineWidth = 1.6;
    for (const c of model.pieces) {
      const [x0, y0] = X.toPx(c.c[0], c.c[1]), tp = c.tip || c.apex, [x1, y1] = X.toPx(tp[0], tp[1]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.arc(x1, y1, 2.2, 0, Math.PI * 2); ctx.fillStyle = inkc; ctx.fill();
    }
  }
  state.move.points.forEach((p, i) => {
    const [x, y] = X.toPx(p.x, p.y);
    ctx.beginPath(); ctx.arc(x, y, p.radius * X.k, 0, Math.PI * 2); ctx.setLineDash([6, 5]); ctx.strokeStyle = muted; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, i === selPoint ? 13 : 10, 0, Math.PI * 2); ctx.fillStyle = i === selPoint ? acc : inkc; ctx.fill();
    ctx.fillStyle = i === selPoint ? '#1b211e' : cssVar('--panel'); ctx.font = '600 13px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y + 1);
  });
}

// ---------- 3D view ----------
const host = $('#view3d');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.append(renderer.domElement);
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
const clipPlanes = [];   // empty, or the one section plane (see the section view below)
const camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8a, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
scene.background = new THREE.Color(0xb9b8b2);
const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, roughness: 0.95, side: THREE.DoubleSide });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMat);
wall.receiveShadow = true; wall.position.z = -0.6; scene.add(wall);
const group = new THREE.Group(); scene.add(group);
let frameGroup = new THREE.Group(), pieceGroup = new THREE.Group();
group.add(frameGroup, pieceGroup);
let lastSize = null, camMode = 'iso';
// ---------- camera navigation ----------
// The mouse map follows what most 3D apps share (Blender, Fusion 360, SolidWorks, Onshape, PrusaSlicer, Sketchfab):
// left or middle drag orbits, right or Shift drag pans, the wheel zooms toward the cursor, Ctrl drag zooms smoothly,
// a double click focuses on the point under the cursor (it becomes the orbit centre), a double click on empty space
// or with the middle button fits the model. "Upright" orbit is a turntable that keeps the wall vertical (Blender's
// default); "free" orbit is a trackball with roll and no limit, so any angle is reachable.
// The turntable spins around the panel's own axis (its depth, z), the way PrusaSlicer spins the print bed:
// a sideways drag walks the camera round the panel's edge, an up/down drag tilts between face-on and edge-on,
// and the panel never tips. yaw/pitch are measured in that panel frame: pitch 90° looks straight at the face.
const NAV_VIEWS = {
  iso: [Math.atan2(-0.55, -0.35), Math.asin(0.76 / Math.hypot(0.55, 0.35, 0.76))],
  front: [0, Math.PI / 2], back: [Math.PI, -Math.PI / 2], left: [-Math.PI / 2, 0], right: [Math.PI / 2, 0],
  top: [Math.PI, 0], bottom: [0, 0],
};
const PANEL_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);   // maps the y-up frame onto z-up
const nav = (() => {
  const cv = renderer.domElement;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const clamp = THREE.MathUtils.clamp, HALF = Math.PI / 2;
  const target = V(0, 0, 10), q = new THREE.Quaternion(), tq = new THREE.Quaternion();
  let dist = 1000, yaw = 0, pitch = 0, free = false, sceneR = 300;
  let anim = null, spin = null, moved = true, pivotUntil = 0, onUser = () => {};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const levelQ = (y, p) => PANEL_UP.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-p, y, 0, 'YXZ')));
  function anglesOf(qq) {
    qq = PANEL_UP.clone().invert().multiply(qq);
    const o = V(0, 0, 1).applyQuaternion(qq), p = Math.asin(clamp(o.y, -1, 1));
    if (Math.abs(o.y) < 0.999) return { yaw: Math.atan2(o.x, o.z), pitch: p };
    const u = V(0, 1, 0).applyQuaternion(qq);
    return { yaw: o.y > 0 ? Math.atan2(-u.x, -u.z) : Math.atan2(u.x, u.z), pitch: p };
  }
  const minD = () => Math.max(6, sceneR * 0.03), maxD = () => sceneR * 30;
  function apply() {
    if (!free) q.copy(levelQ(yaw, pitch));
    camera.quaternion.copy(q);
    camera.position.copy(V(0, 0, dist).applyQuaternion(q).add(target));
    camera.near = Math.max(0.3, dist / 80); camera.far = dist + sceneR * 14; camera.updateProjectionMatrix();
    wall.visible = camera.position.z > wall.position.z + 0.5;   // seen from behind, the wall would hide the panel
    moved = true;
  }
  function orbit(a, b) {   // a: horizontal angle, b: vertical angle (radians)
    if (free) { q.multiply(tq.setFromAxisAngle(V(0, 1, 0), -a)).multiply(tq.setFromAxisAngle(V(1, 0, 0), -b)).normalize(); }
    else { yaw -= a; pitch = clamp(pitch + b, -HALF, HALF); }
    apply();
  }
  function roll(a) { if (!free) return; q.multiply(tq.setFromAxisAngle(V(0, 0, 1), a)).normalize(); apply(); }
  function pan(dx, dy) {
    const wpp = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, cv.clientHeight);
    target.addScaledVector(V(1, 0, 0).applyQuaternion(q), -dx * wpp).addScaledVector(V(0, 1, 0).applyQuaternion(q), dy * wpp);
    apply();
  }
  function zoomAt(f, P) {
    const nd = clamp(dist * f, minD(), maxD()); f = nd / dist;
    if (P) target.sub(P).multiplyScalar(f).add(P);
    dist = nd; apply();
  }
  const ray = new THREE.Raycaster();
  function rayAt(x, y) {
    const r = cv.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), camera);
    return ray.ray;
  }
  // the model point under the cursor (or the wall behind it); null over empty space
  function pick(x, y) {
    rayAt(x, y);
    const objs = [frameGroup, pieceGroup].filter(g => g.visible);
    const hit = ray.intersectObjects(objs, true).find(h => !h.object.userData.cap && (!clipPlanes.length || clipPlanes[0].distanceToPoint(h.point) >= -0.01));
    if (hit) return hit.point.clone();
    if (wall.visible) {
      const p = ray.ray.intersectPlane(new THREE.Plane(V(0, 0, 1), -wall.position.z), V());
      if (p && Math.abs(p.x) < sceneR * 1.6 && Math.abs(p.y) < sceneR * 1.6) return p;
    }
    return null;
  }
  // the point under the cursor on the plane through the orbit centre, facing the camera
  function planePoint(x, y) {
    const n = V(0, 0, 1).applyQuaternion(q);
    return rayAt(x, y).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, target), V()) || target.clone();
  }
  function pointAt(x, y) { const p = pick(x, y); return p && p.distanceTo(camera.position) < dist * 4 ? p : planePoint(x, y); }

  function modelBox() {
    const b = new THREE.Box3();
    [frameGroup, pieceGroup].forEach(g => b.expandByObject(g));
    if (b.isEmpty()) { const s = state.shape; b.set(V(-s.w / 2, -s.h / 2, 0), V(s.w / 2, s.h / 2, 20)); }
    return b;
  }
  function framing(qq) {
    const box = modelBox(), c = box.getCenter(V()), inv = qq.clone().invert();
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), th = tv * camera.aspect;
    sceneR = Math.max(50, box.getSize(V()).length() / 2);
    let d = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = V(x, y, z).sub(c).applyQuaternion(inv);
      d = Math.max(d, Math.abs(p.x) / th + p.z, Math.abs(p.y) / tv + p.z);
    }
    return { target: c, dist: Math.max(d * 1.12, minD()) };
  }
  function animateTo(to, ms = 450, done) {
    spin = null;
    const from = { target: target.clone(), dist, yaw, pitch, q: q.clone() };
    if (!free) {   // turn the short way round
      let dy = (to.yaw - yaw) % (2 * Math.PI); if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
      to = { ...to, yaw: yaw + dy };
    }
    anim = { from, to, t0: performance.now(), ms: reduce.matches ? 0 : ms, done };
  }
  function step(now) {
    const { from, to, t0, ms, done } = anim, t = ms ? Math.min(1, (now - t0) / ms) : 1, e = 1 - Math.pow(1 - t, 3);
    target.lerpVectors(from.target, to.target, e);
    dist = Math.exp(THREE.MathUtils.lerp(Math.log(from.dist), Math.log(to.dist), e));
    if (free) q.slerpQuaternions(from.q, to.q, e); else { yaw = THREE.MathUtils.lerp(from.yaw, to.yaw, e); pitch = THREE.MathUtils.lerp(from.pitch, to.pitch, e); }
    apply();
    if (t >= 1) { anim = null; done && done(); }
  }
  function orient(y, p) { return { yaw: y, pitch: p, q: levelQ(y, p) }; }
  function view(mode, jump) {
    const [y, p] = NAV_VIEWS[mode] || NAV_VIEWS.iso, o = orient(y, p), to = { ...o, ...framing(o.q) };
    animateTo(to, jump ? 0 : 500);
    if (jump) step(performance.now());
  }
  function fit(jump) {
    const o = free ? { yaw, pitch, q: q.clone() } : orient(yaw, pitch);
    animateTo({ ...o, ...framing(o.q) }, jump ? 0 : 450);
    if (jump) step(performance.now());
  }
  function focus(x, y) {
    const p = pick(x, y);
    if (!p) { fit(); onUser(); return; }
    animateTo({ yaw, pitch, q: q.clone(), target: p, dist: clamp(dist * 0.6, minD(), maxD()) }, 450);
    pivotUntil = performance.now() + 1400;
    onUser();
  }
  function setFree(on) {
    if (on === free) return;
    if (on) { free = true; return; }
    // back to upright: remove the roll smoothly, then continue as a turntable
    const a = anglesOf(q), o = orient(a.yaw, a.pitch);
    animateTo({ ...o, target: target.clone(), dist }, 400, () => { free = false; yaw = a.yaw; pitch = a.pitch; apply(); });
  }

  // ---- pointer input (mouse, pen and touch share one path) ----
  const ptrs = new Map();
  let drag = null, gest = null, lastTap = null;
  const rotK = () => Math.PI * 1.4 / Math.max(200, cv.clientHeight);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   // no autoscroll on middle click
  function touchBase() {
    const ps = [...ptrs.values()];
    if (ps.length === 1) { gest = { n: 1, x: ps[0].x, y: ps[0].y }; return; }
    const [a, b] = ps, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    gest = { n: 2, mx, my, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x), P: pointAt(mx, my) };
  }
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); anim = null; spin = null;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button, type: e.pointerType });
    if (e.pointerType === 'touch') { touchBase(); drag = null; return; }
    if (ptrs.size > 1) return;
    const mode = (e.button === 2 || e.shiftKey) ? 'pan' : (e.ctrlKey || e.metaKey) ? 'zoom' : (e.altKey && free) ? 'roll' : 'orbit';
    drag = { mode, x: e.clientX, y: e.clientY, P: mode === 'zoom' ? pointAt(e.clientX, e.clientY) : null, vx: 0, vy: 0, t: 0 };
    cv.classList.add(mode === 'pan' ? 'panning' : 'grabbing');
    pivotUntil = Infinity;
  });
  cv.addEventListener('pointermove', e => {
    const pt = ptrs.get(e.pointerId); if (!pt) return;
    pt.x = e.clientX; pt.y = e.clientY;
    if (pt.type === 'touch') {
      if (!gest) return;
      if (gest.n === 1 && ptrs.size === 1) { const k = rotK(); orbit((pt.x - gest.x) * k, (pt.y - gest.y) * k); gest.x = pt.x; gest.y = pt.y; }
      else if (gest.n === 2 && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
        pan(mx - gest.mx, my - gest.my);
        zoomAt(gest.d / d, gest.P);
        let da = ang - gest.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        roll(da);
        Object.assign(gest, { mx, my, d, ang });
      }
      pivotUntil = performance.now() + 700; onUser();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (!dx && !dy) return;
    if (drag.mode === 'orbit') { const k = rotK(); orbit(dx * k, dy * k); drag.vx = dx * k; drag.vy = dy * k; drag.t = performance.now(); }
    else if (drag.mode === 'pan') pan(dx, dy);
    else if (drag.mode === 'zoom') zoomAt(Math.exp(dy * 0.006), drag.P);
    else if (drag.mode === 'roll') {
      const r = cv.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      roll(Math.atan2(e.clientY - cy, e.clientX - cx) - Math.atan2(e.clientY - dy - cy, e.clientX - dx - cx));
    }
    onUser();
  });
  function endPointer(e) {
    const pt = ptrs.get(e.pointerId); if (!pt) return;
    ptrs.delete(e.pointerId);
    const now = performance.now(), still = Math.hypot(pt.x - pt.x0, pt.y - pt.y0) < 6 && now - pt.t0 < 350;
    if (pt.type === 'touch') { if (ptrs.size) touchBase(); else gest = null; }
    else if (drag) {
      if (drag.mode === 'orbit' && now - drag.t < 60 && !reduce.matches) spin = { a: drag.vx, b: drag.vy };
      drag = null; cv.classList.remove('grabbing', 'panning');
    }
    if (!ptrs.size) pivotUntil = now + 700;
    if (e.type !== 'pointerup' || !still || ptrs.size) { if (!still) lastTap = null; return; }
    if (lastTap && now - lastTap.t < 340 && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 24 && lastTap.button === pt.button) {
      lastTap = null; spin = null;
      if (pt.button === 1) { fit(); onUser(); } else if (pt.button === 0) focus(pt.x, pt.y);
    } else lastTap = { t: now, x: pt.x, y: pt.y, button: pt.button };
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  let wheelP = null, wheelT = 0, wx = 0, wy = 0;
  cv.addEventListener('wheel', e => {
    e.preventDefault(); anim = null; spin = null;
    let d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (e.ctrlKey) d *= 2.5;   // trackpad pinch arrives as Ctrl + small wheel steps
    const now = performance.now();
    if (!wheelP || now - wheelT > 260 || Math.hypot(e.clientX - wx, e.clientY - wy) > 6) { wheelP = pointAt(e.clientX, e.clientY); wx = e.clientX; wy = e.clientY; }
    wheelT = now;
    zoomAt(Math.exp(clamp(d, -240, 240) * 0.0015), wheelP);
    pivotUntil = now + 600; onUser();
  }, { passive: false });

  // ---- keyboard (PrusaSlicer's number keys for the views) ----
  const KEYVIEW = { 0: 'iso', 1: 'top', 2: 'bottom', 3: 'front', 4: 'back', 5: 'left', 6: 'right' };
  function key(e) {
    const k = e.code.replace(/^(Digit|Numpad)/, ''), sh = e.shiftKey, ROT = Math.PI / 12;
    if (k in KEYVIEW && k.length === 1) return { view: KEYVIEW[k] };
    if (e.code === 'KeyF' || e.code === 'Home' || e.code === 'NumpadDecimal') return () => { fit(); onUser(); };
    if (e.code === 'ArrowLeft') return () => { sh ? pan(-40, 0) : orbit(-ROT, 0); onUser(); };
    if (e.code === 'ArrowRight') return () => { sh ? pan(40, 0) : orbit(ROT, 0); onUser(); };
    if (e.code === 'ArrowUp') return () => { sh ? pan(0, -40) : orbit(0, -ROT); onUser(); };
    if (e.code === 'ArrowDown') return () => { sh ? pan(0, 40) : orbit(0, ROT); onUser(); };
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') return () => { zoomAt(1 / 1.25, target); onUser(); };
    if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') return () => { zoomAt(1.25, target); onUser(); };
    return null;
  }
  return {
    view, fit, focus, setFree, key, orbit, pan, zoomAt, pick, modelBox,
    get free() { return free; },
    set onUser(f) { onUser = f; },
    tick(now) {
      if (anim) step(now);
      else if (spin) {   // a flick keeps turning for a moment and eases out (time based, so it feels the same at any frame rate)
        const dt = Math.min(50, now - (spin.t || now - 16)), f = dt / 16; spin.t = now;
        orbit(spin.a * f, spin.b * f); const k = Math.exp(-dt / 110); spin.a *= k; spin.b *= k;
        if (Math.abs(spin.a) + Math.abs(spin.b) < 2e-4) spin = null;
      }
      const pv = $('#pivot'), show = now < pivotUntil;
      if (show) {
        const p = target.clone().project(camera);
        pv.style.transform = `translate(${(p.x + 1) / 2 * cv.clientWidth}px, ${(1 - p.y) / 2 * cv.clientHeight}px)`;
      }
      if (pv.hidden === show) pv.hidden = !show;
      const m = moved; moved = false; return m;
    },
    get state() { return { target: target.toArray(), dist, yaw, pitch, free, q: q.toArray(), cam: camera.position.toArray() }; },
  };
})();

function geomFromMesh(m) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(m.f.length * 3);
  for (let i = 0; i < m.f.length; i++) { const k = m.f[i] * 3; pos[i * 3] = m.v[k]; pos[i * 3 + 1] = m.v[k + 1]; pos[i * 3 + 2] = m.v[k + 2]; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function disposeGroup(gr) { gr.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); gr.clear(); }
// Section caps: every part is a closed solid, so where the plane cuts it the camera looks into its inside faces.
// Drawing those back faces in a flat, darker tone of the part's colour makes the cut read as a solid face.
function capMaterial(hex) {
  const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), hsl.l * 0.55 + 0.04);
  return new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide, clippingPlanes: clipPlanes });
}
function addCap(me, mat) { const cap = new THREE.Mesh(me.geometry, mat); cap.visible = clipPlanes.length > 0; cap.userData.cap = true; me.add(cap); }
function update3D() {
  disposeGroup(frameGroup); disposeGroup(pieceGroup);
  if (!model) return;
  const fr = state.frame;
  const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(fr.color), roughness: 0.75, flatShading: true, clippingPlanes: clipPlanes, clipShadows: true });
  const frameCap = capMaterial(fr.color);
  model.tiles.forEach(tl => { const me = new THREE.Mesh(geomFromMesh(E.tileMesh(tl, fr)), frameMat); me.castShadow = me.receiveShadow = true; addCap(me, frameCap); frameGroup.add(me); });
  if (model.clamps && model.clamps.length) {
    // the clamps between tiles, a shade darker than the frame so they can be told apart in a section
    const cm = new E.Mesh(); model.clamps.forEach(k => cm.append(E.clampPlaced(k, model.clampSpec)));
    const hsl = {}, cc = new THREE.Color(fr.color); cc.getHSL(hsl); cc.setHSL(hsl.h, hsl.s, hsl.l * 0.72);
    const me = new THREE.Mesh(geomFromMesh(cm), new THREE.MeshStandardMaterial({ color: cc, roughness: 0.7, flatShading: true, clippingPlanes: clipPlanes, clipShadows: true }));
    me.castShadow = me.receiveShadow = true; addCap(me, capMaterial('#' + cc.getHexString())); frameGroup.add(me);
  }
  state.color.bands.forEach((hex, b) => {
    const merged = new E.Mesh();
    model.pieces.forEach(c => { if (c.band === b) merged.append(E.pieceMesh(c, fr)); });
    if (!merged.f.length) return;
    const me = new THREE.Mesh(geomFromMesh(merged), new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.62, flatShading: true, clippingPlanes: clipPlanes, clipShadows: true }));
    me.castShadow = me.receiveShadow = true; addCap(me, capMaterial(hex)); pieceGroup.add(me);
  });
  const s = state.shape, size = Math.max(s.w, s.h);
  wall.scale.set(size * 4, size * 4, 1);
  sun.position.set(-size * 0.25, size * 1.1, size * 0.9); sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 1; sc.far = size * 4; sc.updateProjectionMatrix();
  const key = `${s.w}x${s.h}`;
  if (key !== lastSize) { lastSize = key; setCam(camMode, true); }
  cut.refresh();
  invalidate();
}
// ---------- section view ----------
// A cutting plane facing the current view: the slider pushes it from the front of the model to the back, everything
// between the camera and the plane is cut away, and the plane stays put while the model is turned and zoomed.
const cut = (() => {
  const plane = new THREE.Plane(), n = new THREE.Vector3();
  let on = false, t = 0.5, mode = 'view';   // view: faces the camera · base: upright on the base, parallel to the panel side nearest the viewer
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3)),
    new THREE.LineBasicMaterial({ color: 0xf0b429, transparent: true, opacity: 0.9, depthTest: false }));
  edge.renderOrder = 10; edge.visible = false; scene.add(edge);
  function range() {
    const b = nav.modelBox(); let lo = Infinity, hi = -Infinity;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const d = n.dot(new THREE.Vector3(x, y, z)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    return { b, lo, hi };
  }
  function refresh() {
    if (!on) return;
    const { b, lo, hi } = range(), d = lo + (hi - lo) * t;
    plane.set(n, -d);   // keeps the side beyond the plane, as seen from where the section was started
    // outline: where the plane crosses the model's bounding box
    const C = [b.min, b.max], pts = [];
    for (let i = 0; i < 8; i++) for (let k = 0; k < 3; k++) {
      if (i & (1 << k)) continue;
      const a = new THREE.Vector3(C[i & 1].x, C[(i >> 1) & 1].y, C[(i >> 2) & 1].z), j = i | (1 << k);
      const e = new THREE.Vector3(C[j & 1].x, C[(j >> 1) & 1].y, C[(j >> 2) & 1].z);
      const da = plane.distanceToPoint(a), de = plane.distanceToPoint(e);
      if ((da < 0) !== (de < 0)) pts.push(a.clone().lerp(e, da / (da - de)));
    }
    const pos = edge.geometry.attributes.position;
    if (pts.length >= 3) {
      const c = pts.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(pts.length);
      const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(), w = new THREE.Vector3().crossVectors(n, u);
      pts.sort((p, q) => Math.atan2(p.clone().sub(c).dot(w), p.clone().sub(c).dot(u)) - Math.atan2(q.clone().sub(c).dot(w), q.clone().sub(c).dot(u)));
      pts.forEach((p, i) => pos.setXYZ(i, p.x, p.y, p.z));
    }
    edge.geometry.setDrawRange(0, pts.length >= 3 ? pts.length : 0);
    pos.needsUpdate = true; edge.geometry.computeBoundingSphere();
    $('#sectionVal').textContent = Math.round(t * 100) + '%';
    invalidate();
  }
  function setCaps(vis) { [frameGroup, pieceGroup].forEach(g => g.traverse(o => { if (o.userData.cap) o.visible = vis; })); }
  function aim() {
    camera.getWorldDirection(n);
    if (mode === 'base') {   // drop the depth part and snap to the nearest side of the panel (x or y), so the cut stands square on the base
      n.set(Math.abs(n.x) >= Math.abs(n.y) ? Math.sign(n.x) || 1 : 0, Math.abs(n.x) >= Math.abs(n.y) ? 0 : Math.sign(n.y) || 1, 0);
    }
  }
  function set(v) {
    on = v;
    if (on) { aim(); clipPlanes.length = 0; clipPlanes.push(plane); refresh(); }
    else clipPlanes.length = 0;
    setCaps(on); edge.visible = on;
    $('#sectionBtn').setAttribute('aria-pressed', String(on)); $('#sectionBar').hidden = !on;
    invalidate();
  }
  return {
    set, refresh, get on() { return on; },
    depth(v) { t = v; refresh(); },
    mode(m) { mode = m; document.querySelectorAll('#sectionMode [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); if (on) { aim(); refresh(); } },
    reaim() { if (on) { aim(); refresh(); } },
    edges(v) { edge.visible = on && v; invalidate(); },
    get plane() { return plane; },
  };
})();
function setCam(mode, jump) {
  camMode = mode;
  if (mode) nav.view(mode, jump); else nav.fit(jump);
  markCam();
}
function markCam() { document.querySelectorAll('#camViews [data-cam]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === camMode))); }
nav.onUser = () => { if (camMode) { camMode = null; markCam(); } };
function resize() {
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
}
new ResizeObserver(resize).observe(host);
// render on demand: only while the camera moves or after the scene changed (keeps the CPU free for building print files)
var dirty = 2;
function invalidate() { dirty = 2; }
(function loop(now) { if (nav.tick(now || performance.now())) dirty = 2; if (dirty > 0) { renderer.render(scene, camera); dirty--; } requestAnimationFrame(loop); })();

// ---------- rebuild pipeline ----------
let timer = 0;
// the live model never has hanging keyholes (their search is the slow part of a build); they are added
// only when the print kit is downloaded and the user asks for them
function schedule(draft) { clearTimeout(timer); $('#busy').hidden = false; timer = setTimeout(rebuild, draft === true ? 30 : 70); }
function rebuild() {
  const t0 = performance.now();
  try { model = E.build(state, true); buildError = null; }
  catch (e) { buildError = e.message || String(e); console.warn(e); }
  $('#busy').hidden = true;
  if (!buildError) { update3D(); drawPlan(); if (!$('#viewmap').hidden) drawMap(); }
  updateBar();
  window.__lastBuildMs = performance.now() - t0;
}
function plateCount() {
  if (!model) return 0;
  let n = 0;
  state.color.bands.forEach((_, b) => { const items = model.pieces.filter(c => c.band === b).map(c => ({ w: c.fp.w, h: c.fp.h })); if (items.length) n += E.packPlates(items, state.print).length; });
  return n;
}
function weightGrams() {
  if (!model) return 0;
  let vol = 0; const fr = state.frame;
  model.pieces.forEach(c => vol += E.meshVolume(E.pieceMesh(c, fr)) * 0.5);
  model.tiles.forEach(tl => vol += E.meshVolume(E.tileMesh(tl, fr)) * 0.85);
  return vol / 1000 * 1.24;
}
function updateBar() {
  const msg = $('#msg'); msg.textContent = '';
  if (buildError) { msg.append(el('span', { class: 'err' }, buildError)); $('#kitBtn').disabled = true; return; }
  $('#kitBtn').disabled = false;
  if (model.warnings.length) model.warnings.forEach(w => msg.append(el('div', { class: w.kind === 'warn' ? 'warn' : '' }, w.text)));
  else msg.append('הכול מוכן להדפסה. כל קודקוד נבדק לזווית הדפסה בלי תמיכות ולמרחק מהשכנים.');
  const stats = [[model.pieces.length, 'חלקים'], [state.color.bands.length, 'צבעים'], [model.tiles.length, 'אריחי מסגרת'], ...(model.clamps && model.clamps.length ? [[model.clamps.length, 'חבקים']] : []), [plateCount(), 'פלטות'], [Math.round(model.maxZ) + ' מ"מ', 'עומק'], ['≈' + Math.round(weightGrams()) + ' ג׳', 'משקל']];
  const st = $('#stats'); st.textContent = '';
  stats.forEach(([v, l]) => st.append(el('div', { class: 'stat' }, el('b', {}, String(v)), el('span', {}, l))));
}

// ---------- assembly map view ----------
function drawMap() { if (model) $('#viewmap').innerHTML = K.assemblySVG(model, state); }
function setTab(map) {
  $('#tab3d').setAttribute('aria-pressed', String(!map)); $('#tabMap').setAttribute('aria-pressed', String(map));
  $('#viewmap').hidden = !map; $('#view3d').style.visibility = map ? 'hidden' : 'visible';
  $('#camViews').hidden = map; $('#stageNote').textContent = map ? 'המספרים כאן זהים למספרים בפלטות. קו כחול מקווקו: גבול של אריח מסגרת.' : NAV_NOTE();
  if (map) showHelp(false);
  $('#sectionBar').hidden = map || !cut.on;
  if (map) drawMap();
}

// ---------- downloads ----------
const dlP = (window.claude && window.claude.use) ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
function toast(t, ms = 3800) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(e._t); e._t = setTimeout(() => e.hidden = true, ms); }
async function offerFile(filename, blob) {
  const dl = await Promise.race([dlP, new Promise(r => setTimeout(() => r(null), 1500))]);
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast('הקובץ נשמר.'); }
    catch (e) { if (e && e.code === 'declined') toast('ההורדה בוטלה.'); else toast('לא הצלחתי לשמור את הקובץ כאן (' + (e?.code || 'שגיאה') + ').'); }
    return;
  }
  const a = el('a', { href: URL.createObjectURL(blob), download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
const slug = s => (s || 'panel').replace(/[^\w֐-׿-]+/g, '-').replace(/^-|-$/g, '') || 'panel';
// asks whether to add hanging keyholes; resolves true / false, or null when cancelled
function askHang() {
  return new Promise(res => {
    const dlg = el('dialog', { class: 'ask', 'aria-labelledby': 'askTitle' });
    const done = v => { dlg.close(); dlg.remove(); res(v); };
    dlg.append(
      el('h2', { id: 'askTitle' }, 'האם להוסיף חורי תלייה?'),
      el('p', {}, 'חורי מנעול בצורת L ליד ארבע הפינות, בתוך החלקים שיש בהם מקום, לפי המנגנון שגיבשנו. מפת ההרכבה תתעדכן בהתאם. החישוב לוקח כמה שניות.'),
      el('div', { class: 'ask-btns' },
        el('button', { class: 'primary', onclick: () => done(true) }, 'כן, להוסיף חורי תלייה'),
        el('button', { class: 'btn', onclick: () => done(false) }, 'לא, בלי חורים'),
        el('button', { class: 'btn', onclick: () => done(null) }, 'ביטול')));
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    document.body.append(dlg); dlg.showModal();
  });
}
$('#kitBtn').addEventListener('click', async () => {
  clearTimeout(timer); rebuild();
  if (!model) return;
  const hang = await askHang();
  if (hang === null) return;
  const btn = $('#kitBtn'); btn.disabled = true; const old = btn.innerHTML;
  btn.lastChild.textContent = hang ? 'מחשב חורי תלייה…' : 'מכין קבצים…';
  await new Promise(r => setTimeout(r, 30));   // let the label paint before the long build
  try {
    const st = clone(state); st.frame.hang = Object.assign({}, st.frame.hang, { on: hang });
    const km = hang ? E.build(st) : model;
    if (hang) {
      btn.lastChild.textContent = 'מכין קבצים…';
      const hw = km.warnings.filter(w => /תלייה|חור/.test(w.text));
      if (hw.length) toast(hw.map(w => w.text).join(' '), 9000);
    }
    const names = st.color.bands.map(h => (PR.palette.find(p => p[1] === h.toLowerCase()) || [h.slice(1)])[0]);
    const { blob } = await K.buildKit(km, st, window.JSZip, { colorNames: names.map(n => /^[0-9a-f]{6}$/i.test(n) ? n : n) });
    await offerFile('tavlit-print-kit.zip', blob);
  } catch (e) { console.error(e); toast('יצירת הערכה נכשלה: ' + e.message, 6000); }
  btn.innerHTML = old; btn.disabled = false;
});
$('#fitBtn').addEventListener('click', async () => {
  // a stretch of this design's own frame (its seam, clamps and cells) when the panel has more than one tile;
  // the small square strip otherwise
  try {
    clearTimeout(timer); rebuild();
    const r = model && (model.clamps || []).length ? await K.buildShapeFitTest(model, clone(state), window.JSZip) : null;
    if (r) { await offerFile('fit-test-design.zip', r.blob); toast(`בדיקת התאמה מתוך העיצוב: התפר בין אריחים ${r.section.tiles.join(' ו-')}, ${r.section.clamps} חבקים ו-${r.section.pieces} חלקים.`, 6000); }
    else { const blob = await K.buildFitTest(state, window.JSZip); await offerFile('fit-test-mk4.zip', blob); }
  }
  catch (e) { toast('יצירת בדיקת ההתאמה נכשלה: ' + e.message, 6000); }
});
$('#saveBtn').addEventListener('click', () => offerFile('tavlit-design.json', new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })));
$('#loadFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { state = normalize(JSON.parse(await f.text())); selPoint = 0; selBand = 0; commit(); renderPanel(); schedule(); lastSize = null; toast('העיצוב נטען.'); }
  catch (err) { toast('הקובץ לא נראה כמו עיצוב שנשמר מכאן.'); }
  e.target.value = '';
});

// ---------- header & tabs ----------
const sel = $('#presetSel');
sel.append(el('option', { value: '' }, 'עיצובים מוכנים…'), ...PR.presets.map(p => el('option', { value: p.key }, p.label)));
sel.addEventListener('change', () => {
  const p = PR.presets.find(x => x.key === sel.value); sel.value = ''; if (!p) return;
  state = normalize(clone(p.state)); selPoint = 0; selBand = 0; addMode = null; lastSize = null; commit(); renderPanel(); schedule();
});
$('#designName').addEventListener('change', e => { state.name = e.target.value.trim() || 'עיצוב'; commit(); });
$('#undoBtn').addEventListener('click', () => hIndex > 0 && restore(hIndex - 1));
$('#redoBtn').addEventListener('click', () => hIndex < history.length - 1 && restore(hIndex + 1));
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.target.matches('input[type=number],input[type=text],input:not([type])')) return;
  if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); hIndex > 0 && restore(hIndex - 1); }
  else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); hIndex < history.length - 1 && restore(hIndex + 1); }
});
$('#tab3d').addEventListener('click', () => setTab(false));
$('#tabMap').addEventListener('click', () => setTab(true));
document.querySelectorAll('#camViews [data-cam]').forEach(b => b.addEventListener('click', () => setCam(b.dataset.cam)));
const NAV_NOTE = () => matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches
  ? 'אצבע אחת: סיבוב · שתיים: הזזה וזום · הקשה כפולה: מיקוד · ? לעזרה'
  : 'גרירה או כפתור אמצעי: סיבוב · ימני או Shift: הזזה · גלגלת: זום לסמן · לחיצה כפולה: מיקוד · F: התאמה · ? לעזרה';
$('#stageNote').textContent = NAV_NOTE();
function showHelp(on) { $('#navHelp').hidden = !on; $('#navHelpBtn').setAttribute('aria-pressed', String(on)); }
function setFreeOrbit(on) { nav.setFree(on); $('#freeOrbit').setAttribute('aria-pressed', String(on)); toast(on ? 'סיבוב חופשי: אין נעילת אופק, Alt + גרירה מגלגל.' : 'סיבוב סביב ציר הפאנל: הפאנל לא נוטה.', 2400); }
$('#fitView').addEventListener('click', () => { nav.fit(); camMode = null; markCam(); });
$('#freeOrbit').addEventListener('click', () => setFreeOrbit(!nav.free));
$('#sectionBtn').addEventListener('click', () => cut.set(!cut.on));
$('#sectionDepth').addEventListener('input', e => cut.depth(+e.target.value / 100));
$('#sectionEdge').addEventListener('change', e => cut.edges(e.target.checked));
$('#sectionReset').addEventListener('click', () => cut.reaim());
document.querySelectorAll('#sectionMode [data-mode]').forEach(b => b.addEventListener('click', () => cut.mode(b.dataset.mode)));
$('#navHelpBtn').addEventListener('click', e => { e.stopPropagation(); showHelp($('#navHelp').hidden); });
document.addEventListener('pointerdown', e => { if (!$('#navHelp').hidden && !e.target.closest('#navHelp,#navHelpBtn')) showHelp(false); });
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || !$('#viewmap').hidden || e.target.closest('input,select,textarea,[contenteditable],dialog')) return;
  if (e.key === 'Escape') { showHelp(false); return; }
  if (e.key === '?' || e.code === 'KeyH' || (e.code === 'Slash' && e.shiftKey)) { e.preventDefault(); showHelp($('#navHelp').hidden); return; }
  if (e.code === 'KeyR') { setFreeOrbit(!nav.free); return; }
  if (e.code === 'KeyC') { cut.set(!cut.on); return; }
  const act = nav.key(e); if (!act) return;
  e.preventDefault();
  if (act.view) setCam(act.view); else act();
});
$('#showFrame').addEventListener('click', e => { frameGroup.visible = !frameGroup.visible; e.currentTarget.setAttribute('aria-pressed', String(frameGroup.visible)); });
$('#showPieces').addEventListener('click', e => { pieceGroup.visible = !pieceGroup.visible; e.currentTarget.setAttribute('aria-pressed', String(pieceGroup.visible)); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawPlan);

renderPanel(); updateUndo(); resize(); rebuild();
window.__tavlit = { nav, cut, get state() { return state; }, get model() { return model; }, rebuild, setState: s => { state = normalize(s); lastSize = null; renderPanel(); rebuild(); } };
