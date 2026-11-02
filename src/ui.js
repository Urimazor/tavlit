import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const E = window.WallEngine, K = window.WallKit, PR = window.WallPresets;
const $ = s => document.querySelector(s);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- state, history, persistence ----------
const LS_KEY = 'tavlit-design-v2';
let state = loadLocal() || clone(PR.presets[1].state);
let history = [JSON.stringify(state)], hIndex = 0;
let model = null, buildError = null;
let selPoint = 0, selBand = 0, addMode = null;
const openSecs = new Set(['move']);

function loadLocal() { try { const s = localStorage.getItem(LS_KEY); return s ? normalize(JSON.parse(s)) : null; } catch (e) { return null; } }
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }
function normalize(s) {
  const base = clone(PR.presets[1].state);
  for (const k of Object.keys(base)) if (typeof base[k] === 'object' && !Array.isArray(base[k])) s[k] = Object.assign({}, base[k], s[k] || {});
  s.move.points = (s.move.points || []).map(p => Object.assign({ type: 'vortex', x: 0, y: 0, strength: 1, radius: 80, fade: 120, opening: 0, angle: 0, curve: 0, spiral: 0 }, p));
  s.piece = Object.assign({ curve: 0, twist: 0, spiral: 0, profile: 1, layers: 10, smooth: 0, truncate: 0, dome: 0, cutTilt: 0, cutBy: 'field', cutAngle: 0, cutVary: 0 }, s.piece || {});
  s.frame = Object.assign({ joint: 9, jointClr: 0.05, knobW: 5 }, s.frame);
  // Uri's fit test on the MK4 (2026-11-02): 0.05 mm fits best; move designs still on the old 0.15 default
  if (!s.fitCal) { if (s.frame.clr === 0.15) s.frame.clr = 0.05; if (s.frame.jointClr === 0.15) s.frame.jointClr = 0.05; s.fitCal = 1; }
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
    schedule(); if (fin) { commit(); opts.onCommit?.(); }
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
    slider('שוליים', 'המסגרת החיצונית', 'shape.rim', 3, 30, 0.5, 'מ"מ')
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
    pc.truncate > 0 ? el('div', { class: 'field-label' }, 'זווית הקיטום') : null,
    pc.truncate > 0 ? el('p', { class: 'hint' }, 'במקום חיתוך מקביל לקיר, משטח החיתוך נוטה ופונה לכיוון מסוים. הכיוון יכול לבוא מנקודות התנועה (מערבולת, מגנט, זרם), מהמרכז, מספירלה או משיפוע פני השטח. לכל נקודת תנועה אפשר גם להוסיף זווית משלה.') : null,
    pc.truncate > 0 ? slider('זווית קיטום', '0 = אופקי, מקביל לקיר', 'piece.cutTilt', 0, 75, 1, '°') : null,
    pc.truncate > 0 ? chips('מה קובע לאן המשטח פונה', 'piece.cutBy', CUTBY) : null,
    pc.truncate > 0 ? slider(pc.cutBy === 'fixed' ? 'כיוון' : 'סיבוב הכיוון', pc.cutBy === 'fixed' ? 'לאן פונה המשטח החתוך' : '180 = הפוך, 90 = לרוחב', 'piece.cutAngle', -180, 180, 1, '°') : null,
    pc.truncate > 0 && pc.cutBy !== 'fixed' ? slider('זווית לפי עוצמה', '0 = אותה זווית בכל הלוח, 1 = הזווית גדלה איפה שההשפעה חזקה', 'piece.cutVary', 0, 1, 0.05, '') : null
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
    slider('זווית קיטום נוספת', 'לחלקים קטומים באזור הנקודה', `move.points.${selPoint}.cut`, -60, 60, 1, '°'),
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
    el('p', { class: 'hint' }, 'הלוח שנתלה על הקיר. כל חלק ננעץ בתא שלו. כדאי להתחיל ב"בדיקת התאמה" כדי לכייל את המרווח למדפסת שלך. ברירת המחדל לשני המרווחים (נעיצה ומחבר) היא 0.05 מ"מ, לפי בדיקת ההתאמה על ה-MK4.'),
    slider('עובי המסגרת', '', 'frame.t', 2, 6, 0.2, 'מ"מ'),
    slider('רוחב צלע', 'בין התאים', 'frame.rib', 1.6, 6, 0.1, 'מ"מ'),
    slider('מרווח התאמה', 'לכל צד, נעיצה · ברירת מחדל 0.05', 'frame.clr', 0, 0.5, 0.01, 'מ"מ'),
    slider('רווח בין חלקים', '', 'frame.gap', 0.1, 2, 0.05, 'מ"מ'),
    el('div', { class: 'field-label' }, 'חיבור בין אריחים'),
    el('p', { class: 'hint' }, 'המסגרת מתחלקת לאורך גבולות של תאים שלמים. בכל חיבור יש מחברי זנב יונה שננעלים כמו פאזל, ודבק רק מקבע אותם.'),
    slider('רוחב צלע בחיבור', 'מקום למחבר', 'frame.joint', 6, 14, 0.5, 'מ"מ'),
    slider('רוחב צוואר המחבר', '', 'frame.knobW', 3, 8, 0.5, 'מ"מ'),
    slider('מרווח במחבר', 'לכל צד · ברירת מחדל 0.05', 'frame.jointClr', 0, 0.4, 0.01, 'מ"מ'),
    el('div', { class: 'field-label' }, 'תלייה על הקיר'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: fr.hang.on, onchange: (e) => { fr.hang.on = e.target.checked; commit(); renderPanel(); schedule(); } }), 'חורי תלייה בארבע הפינות'),
    fr.hang.on ? el('p', { class: 'hint' }, 'ליד כל פינה יש מאחור חור מנעול בצורת L: ראש הבורג נכנס בעיגול, והפאנל מחליק עד שהבורג נתפס בקצה הזרוע. הזרוע האנכית לתלייה לאורך והזרוע שפונה לצד לתלייה לרוחב, ותמיד משתמשים בשני הברגים העליונים. החלקים והחלוקה נראים בדיוק כמו בלי חורי תלייה: החור ממוקם רק מתחת לחלק שיש בתוכו מקום לחלל, גם אם הוא לא בפינה ממש.') : null,
    fr.hang.on ? slider('קוטר ראש הבורג', '', 'frame.hang.head', 6, 12, 0.1, 'מ"מ') : null,
    fr.hang.on ? slider('קוטר גוף הבורג', '', 'frame.hang.shank', 3, 6, 0.1, 'מ"מ') : null,
    fr.hang.on ? slider('עובי ראש הבורג', 'דק יותר = יותר חלקים מתאימים', 'frame.hang.headH', 2, 6, 0.1, 'מ"מ') : null,
    fr.hang.on ? slider('אורך ההחלקה', '', 'frame.hang.slot', 8, 20, 0.5, 'מ"מ') : null,
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
    drawPlan(); schedule();
  });
  const end = () => { if (drag >= 0) { drag = -1; commit(); renderPanel(); } };
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
      const [x0, y0] = X.toPx(c.c[0], c.c[1]), [x1, y1] = X.toPx(c.apex[0], c.apex[1]);
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
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;
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

function geomFromMesh(m) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(m.f.length * 3);
  for (let i = 0; i < m.f.length; i++) { const k = m.f[i] * 3; pos[i * 3] = m.v[k]; pos[i * 3 + 1] = m.v[k + 1]; pos[i * 3 + 2] = m.v[k + 2]; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function disposeGroup(gr) { gr.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); gr.clear(); }
function update3D() {
  disposeGroup(frameGroup); disposeGroup(pieceGroup);
  if (!model) return;
  const fr = state.frame;
  const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(fr.color), roughness: 0.75, flatShading: true });
  model.tiles.forEach(tl => { const me = new THREE.Mesh(geomFromMesh(E.tileMesh(tl, fr)), frameMat); me.castShadow = me.receiveShadow = true; frameGroup.add(me); });
  state.color.bands.forEach((hex, b) => {
    const merged = new E.Mesh();
    model.pieces.forEach(c => { if (c.band === b) merged.append(E.pieceMesh(c, fr)); });
    if (!merged.f.length) return;
    const me = new THREE.Mesh(geomFromMesh(merged), new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.62, flatShading: true }));
    me.castShadow = me.receiveShadow = true; pieceGroup.add(me);
  });
  const s = state.shape, size = Math.max(s.w, s.h);
  wall.scale.set(size * 4, size * 4, 1);
  sun.position.set(-size * 0.25, size * 1.1, size * 0.9); sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 1; sc.far = size * 4; sc.updateProjectionMatrix();
  const key = `${s.w}x${s.h}`;
  if (key !== lastSize) { lastSize = key; setCam(camMode, true); }
  invalidate();
}
function setCam(mode, jump) {
  camMode = mode;
  const s = state.shape, size = Math.max(s.w, s.h * 1.15), d = size / (2 * Math.tan(THREE.MathUtils.degToRad(16))) * 1.12;
  const dirs = { iso: [-0.55, 0.35, 0.76], front: [0, 0, 1], side: [-0.93, 0.08, 0.36] };
  const v = new THREE.Vector3(...dirs[mode]).normalize().multiplyScalar(d);
  camera.position.copy(v); controls.target.set(0, 0, 10); camera.near = d / 50; camera.far = d * 10; camera.updateProjectionMatrix(); controls.update(); invalidate();
  document.querySelectorAll('#camViews [data-cam]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === mode)));
}
function resize() {
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
}
new ResizeObserver(resize).observe(host);
// render on demand: only while the camera moves or after the scene changed (keeps the CPU free for building print files)
var dirty = 2;
function invalidate() { dirty = 2; }
controls.addEventListener('change', invalidate);
(function loop() { if (controls.update()) dirty = 2; if (dirty > 0) { renderer.render(scene, camera); dirty--; } requestAnimationFrame(loop); })();

// ---------- rebuild pipeline ----------
let timer = 0;
function schedule() { clearTimeout(timer); $('#busy').hidden = false; timer = setTimeout(rebuild, 70); }
function rebuild() {
  const t0 = performance.now();
  try { model = E.build(state); buildError = null; }
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
  const stats = [[model.pieces.length, 'חלקים'], [state.color.bands.length, 'צבעים'], [model.tiles.length, 'אריחי מסגרת'], [plateCount(), 'פלטות'], [Math.round(model.maxZ) + ' מ"מ', 'עומק'], ['≈' + Math.round(weightGrams()) + ' ג׳', 'משקל']];
  const st = $('#stats'); st.textContent = '';
  stats.forEach(([v, l]) => st.append(el('div', { class: 'stat' }, el('b', {}, String(v)), el('span', {}, l))));
}

// ---------- assembly map view ----------
function drawMap() { if (model) $('#viewmap').innerHTML = K.assemblySVG(model, state); }
function setTab(map) {
  $('#tab3d').setAttribute('aria-pressed', String(!map)); $('#tabMap').setAttribute('aria-pressed', String(map));
  $('#viewmap').hidden = !map; $('#view3d').style.visibility = map ? 'hidden' : 'visible';
  $('#camViews').hidden = map; $('#stageNote').textContent = map ? 'המספרים כאן זהים למספרים בפלטות. קו כחול מקווקו: גבול של אריח מסגרת.' : 'גרירה: סיבוב · Shift או כפתור ימני: הזזה · גלגלת: זום';
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
$('#kitBtn').addEventListener('click', async () => {
  if (!model) return;
  const btn = $('#kitBtn'); btn.disabled = true; const old = btn.innerHTML; btn.lastChild.textContent = 'מכין קבצים…';
  try {
    const names = state.color.bands.map(h => (PR.palette.find(p => p[1] === h.toLowerCase()) || [h.slice(1)])[0]);
    const { blob } = await K.buildKit(model, state, window.JSZip, { colorNames: names.map(n => /^[0-9a-f]{6}$/i.test(n) ? n : n) });
    await offerFile('tavlit-print-kit.zip', blob);
  } catch (e) { console.error(e); toast('יצירת הערכה נכשלה: ' + e.message, 6000); }
  btn.innerHTML = old; btn.disabled = false;
});
$('#fitBtn').addEventListener('click', async () => {
  try { const blob = await K.buildFitTest(state, window.JSZip); await offerFile('fit-test-mk4.zip', blob); }
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
$('#showFrame').addEventListener('click', e => { frameGroup.visible = !frameGroup.visible; e.currentTarget.setAttribute('aria-pressed', String(frameGroup.visible)); });
$('#showPieces').addEventListener('click', e => { pieceGroup.visible = !pieceGroup.visible; e.currentTarget.setAttribute('aria-pressed', String(pieceGroup.visible)); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawPlan);

renderPanel(); updateUndo(); resize(); rebuild();
window.__tavlit = { get state() { return state; }, get model() { return model; }, rebuild, setState: s => { state = normalize(s); lastSize = null; renderPanel(); rebuild(); } };
